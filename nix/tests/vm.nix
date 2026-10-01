# NixOS VM test: darius on a real NixOS, run by its real systemd user units.
#
# Two users, two installs, one machine:
#   alice  the home-manager module (services.darius), Bun, credentials 0400
#          as sops-nix delivers them.
#   bob    a plain checkout with `bin/darius setup --systemd --remote`, Node
#          only, credentials 0600. This is the install that failed on NixOS
#          in v0.2.0 (the unit PATH had no bash).
# Each runs vigil-sweep, run-due, sync and snapshot through systemd exactly as the timers
# would, against a SeaweedFS in the VM. A fake `claude` runs the PreToolUse
# hook and completes the run with `darius` from the unit PATH.
{
  self,
  pkgs,
  home-manager,
}:

let
  inherit (pkgs) lib;

  s3Port = 8333;
  accessKey = "vm-test-access";
  secretKey = "vm-test-secret-throwaway";

  # Throwaway identity and SSE key. They exist only inside the test VM.
  seaweedConfig = pkgs.runCommand "darius-vm-seaweedfs-config" { } ''
    mkdir -p $out
    cat > $out/identity.json <<'EOF'
    ${builtins.toJSON {
      identities = [
        {
          name = "darius-vm";
          credentials = [ { inherit accessKey secretKey; } ];
          actions = [
            "Admin"
            "Read"
            "Write"
            "List"
            "Tagging"
          ];
        }
      ];
    }}
    EOF
    printf '[s3.sse]\nkey = "%s"\n' "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=" > $out/security.toml
  '';

  credentials = pkgs.writeText "darius-vm-credentials" ''
    [default]
    aws_access_key_id = ${accessKey}
    aws_secret_access_key = ${secretKey}
  '';

  # `darius vigil add` is a legacy verb: it writes `.tracker/vigils/` through
  # the vendored CLI, and `vigil sweep` reads the store only (docs/concept.md,
  # "Backward compatibility"). No CLI verb puts a vigil with a custom check
  # into the store yet, so the test calls `addVigil`, the function the verb
  # will call once vigils join DARIUS_KINDS, from the checkout it installed.
  addStoreVigil = pkgs.writeText "darius-vm-add-vigil.mts" ''
    import { readFileSync } from "node:fs";
    import { pathToFileURL } from "node:url";

    const src = pathToFileURL(`''${process.env.DARIUS_SRC}/`).href;
    const { addVigil } = await import(`''${src}core/sweep.ts`);
    const { openProject } = await import(`''${src}core/store.ts`);
    const { defaultWho } = await import(`''${src}core/ledger.ts`);

    const [project, slug, title, due] = process.argv.slice(2);
    addVigil(openProject(project, { create: true }), {
      slug,
      title,
      due,
      heavy: false,
      body: readFileSync(0, "utf8"),
      who: defaultWho(),
    });
    console.log(`added vigil ''${slug} to ''${project}`);
  '';

  bobConfig = pkgs.writeText "darius-vm-bob-config.toml" ''
    host = "vm-bob"

    [notify]
    webhook = ""

    [remote]
    endpoint = "http://127.0.0.1:${toString s3Port}"
    bucket = "darius-bob"
    region = "us-east-1"
    path_style = true
    allow_http = true
    sse = true
    credentials = "~/.config/darius/credentials"
  '';

  # What `git clone` gives bob: the repo files, shebangs untouched.
  checkout = lib.fileset.toSource {
    root = ../..;
    fileset = lib.fileset.unions [
      ../../bin
      ../../scripts
      ../../src
      ../../systemd
      ../../package.json
    ];
  };

  # Stands in for Claude Code. It does what an unattended run needs from the
  # real one: print a version, pass the gate check per harness version
  # (0.19.0: the check runs in `_global`, and its gate must deny a `touch`),
  # run the PreToolUse hook from --settings on one allowed Bash call,
  # complete the run with `darius` from PATH, and print a result object.
  fakeClaude = pkgs.writeShellApplication {
    name = "claude";
    runtimeInputs = [ pkgs.jq ];
    text = ''
      if [ "''${1:-}" = "--version" ]; then
        printf '2.1.999 (Claude Code)\n'
        exit 0
      fi
      settings=""
      prev=""
      for arg in "$@"; do
        if [ "$prev" = "--settings" ]; then settings="$arg"; fi
        prev="$arg"
      done
      mapfile -t hook < <(jq -r '.hooks.PreToolUse[0].hooks[0] | .command, .args[]' "$settings")
      if [ "''${DARIUS_PROJECT:-}" = "_global" ]; then
        # The gate check: ask for the marker; the gate must deny it, so nothing is touched.
        printf '%s' '{"tool_name":"Bash","tool_input":{"command":"touch /tmp/darius-vm-check-marker"}}' | "''${hook[@]}" > /dev/null || true
        printf '%s\n' '{"type":"result","subtype":"success","is_error":false,"result":"checked","session_id":"vm-check","total_cost_usd":0,"num_turns":1}'
        exit 0
      fi
      decision="$(printf '%s' '{"tool_name":"Bash","tool_input":{"command":"date"}}' | "''${hook[@]}")"
      printf 'hook=%s\noutput=%s\n' "''${hook[0]}" "$decision" > "$HOME/fake-claude-hook.txt"
      # A launched run must end with a result block (0.22.0).
      darius run complete "$DARIUS_RUN" --project "$DARIUS_PROJECT" --outcome complete --findings-stdin <<'FINDINGS'
      fake claude ran on NixOS
      ```darius-result
      {"v":1,"status":"ok","summary":"fake claude ran on NixOS"}
      ```
      FINDINGS
      printf '%s\n' '{"type":"result","subtype":"success","is_error":false,"result":"done","session_id":"vm-test","total_cost_usd":0,"num_turns":1}'
    '';
  };
in
pkgs.testers.runNixOSTest {
  name = "darius-nixos";

  nodes.machine = {
    imports = [ home-manager.nixosModules.home-manager ];

    virtualisation = {
      memorySize = 2048;
      diskSize = 4096;
      cores = 2;
    };

    users.users.alice = {
      isNormalUser = true;
      uid = 1000;
      linger = true;
    };
    users.users.bob = {
      isNormalUser = true;
      uid = 1001;
      linger = true;
      packages = [
        pkgs.nodejs_24
        pkgs.git
        fakeClaude
      ];
    };

    # curl checks darius-web.service's /healthz from inside the VM.
    environment.systemPackages = [ pkgs.curl ];

    environment.etc."darius-test/credentials".source = credentials;
    environment.etc."darius-test/bob-config.toml".source = bobConfig;
    environment.etc."darius-test/add-vigil.mts".source = addStoreVigil;

    systemd.services.seaweedfs = {
      description = "SeaweedFS for the darius VM test";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];
      serviceConfig = {
        ExecStart = lib.concatStringsSep " " [
          "${pkgs.seaweedfs}/bin/weed"
          "-config_dir=${seaweedConfig}"
          "server"
          "-dir=/var/lib/seaweedfs"
          "-ip=127.0.0.1"
          "-ip.bind=127.0.0.1"
          "-master.volumeSizeLimitMB=64"
          "-volume.max=20"
          "-s3"
          "-s3.port=${toString s3Port}"
          "-s3.config=${seaweedConfig}/identity.json"
        ];
        StateDirectory = "seaweedfs";
        DynamicUser = true;
      };
    };

    home-manager = {
      useGlobalPkgs = true;
      useUserPackages = true;
      users.alice = {
        imports = [ self.homeManagerModules.default ];
        home.stateVersion = "25.05";
        home.packages = [ fakeClaude ];
        services.darius = {
          enable = true;
          # Off by default since 0.14.0; alice is the host that shows the page.
          web.enable = true;
          settings = {
            host = "vm-alice";
            remote = {
              endpoint = "http://127.0.0.1:${toString s3Port}";
              bucket = "darius-alice";
              allow_http = true;
              credentials = "/home/alice/.secrets/darius.credentials";
            };
          };
        };
      };
    };
  };

  testScript = ''
    import json
    import shlex

    TIMERS = ["darius-sync", "darius-vigil-sweep", "darius-run-due", "darius-snapshot"]
    UIDS = {"alice": 1000, "bob": 1001}

    def as_user(user, cmd):
        return machine.succeed(f"su - {user} -c {shlex.quote(cmd)}")

    def user_ctl(user, args):
        return as_user(user, f"XDG_RUNTIME_DIR=/run/user/{UIDS[user]} systemctl --user {args}")

    def add_store_vigil(user, project, slug, title, command):
        # Writes a vigil into the user's store, from the checkout in ~/darius.
        body = f"# checks\n\n- [ ] {title}\n  - Command: `{command}`\n  - Expected: `exit 0`\n"
        return as_user(
            user,
            f"DARIUS_SRC=$HOME/darius/src node --no-warnings /etc/darius-test/add-vigil.mts"
            f" {shlex.quote(project)} {shlex.quote(slug)} {shlex.quote(title)} 2026-01-01 <<'EOF'\n{body}EOF",
        )

    def vigil_status(user, project, slug):
        status = json.loads(as_user(user, f"~/.local/bin/darius selftest status --project {project} --json"))
        return next(v for v in status["vigils"] if v["slug"] == slug)

    def run_unit(user, unit):
        # `start` on a oneshot returns when the unit is done.
        status, _ = machine.execute(
            f"su - {user} -c 'XDG_RUNTIME_DIR=/run/user/{UIDS[user]} systemctl --user start {unit}.service'"
        )
        result = user_ctl(user, f"show -p Result --value {unit}.service").strip()
        if status != 0 or result != "success":
            print(machine.succeed(f"journalctl --no-pager -o cat _UID={UIDS[user]} _SYSTEMD_USER_UNIT={unit}.service"))
            raise Exception(f"{user}: {unit}.service ended {result!r}, start exit {status}")

    def check_selftest(user, darius):
        status = json.loads(as_user(user, f"{darius} selftest status --json"))
        vigils = {v["slug"]: v for v in status["vigils"]}
        assert vigils["date-held"]["state"] == "closed", vigils["date-held"]
        assert vigils["date-held"].get("verdict") == "held", vigils["date-held"]
        assert vigils["date-failed"]["flagged"], vigils["date-failed"]
        runs = json.loads(as_user(user, f"{darius} run list --project darius-selftest --json"))
        print(json.dumps(runs, indent=2))
        text = json.dumps(runs)
        assert '"complete"' in text, "no completed heartbeat run"
        hook = as_user(user, "cat ~/fake-claude-hook.txt")
        print(hook)
        assert "deny" not in hook, hook

    machine.wait_for_unit("multi-user.target")
    machine.wait_for_unit("seaweedfs.service")
    machine.wait_for_open_port(${toString s3Port})
    for user, uid in UIDS.items():
        machine.wait_for_unit(f"user@{uid}.service")
    machine.wait_for_unit("home-manager-alice.service")

    with subtest("alice: home-manager declares the timers, and they run"):
        for t in TIMERS:
            machine.wait_until_succeeds(
                f"su - alice -c 'XDG_RUNTIME_DIR=/run/user/1000 systemctl --user is-active {t}.timer'"
            )
        unit = user_ctl("alice", "cat darius-run-due.service")
        assert "/etc/profiles/per-user/alice/bin" in unit, unit
        assert "/run/current-system/sw/bin" in unit, unit
        timer = user_ctl("alice", "cat darius-run-due.timer")
        assert "OnCalendar=*:05/15" in timer, timer

    with subtest("alice: home-manager also declares darius-web.service, and it answers healthz"):
        machine.wait_until_succeeds(
            "su - alice -c 'XDG_RUNTIME_DIR=/run/user/1000 systemctl --user is-active darius-web.service'"
        )
        machine.wait_until_succeeds("curl -sf http://127.0.0.1:4747/healthz | grep -q ok")

    with subtest("alice: credentials 0400, as sops-nix writes them"):
        machine.succeed("install -d -m 0700 -o alice -g users /home/alice/.secrets")
        machine.succeed("install -m 0400 -o alice -g users /etc/darius-test/credentials /home/alice/.secrets/darius.credentials")
        out = as_user("alice", "darius setup --remote")
        print(out)
        machine.fail("test -e /home/alice/.local/bin/darius")

    with subtest("alice: setup --systemd leaves the home-manager units alone, darius-web.service included"):
        out = as_user("alice", "XDG_RUNTIME_DIR=/run/user/1000 darius setup --systemd")
        print(out)
        assert "home-manager" in out, out
        machine.succeed("readlink /home/alice/.config/systemd/user/darius-sync.service | grep -q ^/nix/store/")
        machine.succeed("readlink /home/alice/.config/systemd/user/darius-web.service | grep -q ^/nix/store/")

    with subtest("alice: every unit once, as its timer would"):
        as_user("alice", "darius selftest seed")
        for unit in ["darius-vigil-sweep", "darius-run-due", "darius-sync", "darius-snapshot"]:
            run_unit("alice", unit)
        check_selftest("alice", "darius")

    with subtest("alice: the web app renders the store, with a nonce CSP, from the packaged build"):
        page = machine.succeed("curl -sf http://127.0.0.1:4747/")
        assert "darius-selftest" in page, page[:2000]
        ritual = machine.succeed("curl -sf http://127.0.0.1:4747/p/darius-selftest/rituals/heartbeat")
        assert "heartbeat" in ritual, ritual[:2000]
        machine.succeed("curl -sfI http://127.0.0.1:4747/ | grep -qi \"^content-security-policy: .*'nonce-\"")

    with subtest("alice: a fresh store pulls what the sync unit pushed"):
        as_user("alice", "DARIUS_STATE_DIR=/tmp/alice-pull darius sync --project darius-selftest --pull-only")
        rituals = as_user("alice", "DARIUS_STATE_DIR=/tmp/alice-pull darius ritual list --project darius-selftest --json")
        assert "heartbeat" in rituals, rituals

    with subtest("bob: git checkout, then darius setup --systemd --remote"):
        machine.succeed("cp -r ${checkout} /home/bob/darius")
        machine.succeed("chown -R bob:users /home/bob/darius && chmod -R u+w /home/bob/darius")
        assert machine.succeed("head -1 /home/bob/darius/bin/darius").strip() == "#!/usr/bin/env bash"
        as_user("bob", "mkdir -p ~/.config/darius")
        as_user("bob", "install -m 0600 /etc/darius-test/credentials ~/.config/darius/credentials")
        as_user("bob", "install -m 0644 /etc/darius-test/bob-config.toml ~/.config/darius/config.toml")
        # A distinct port: alice's darius-web.service already holds 127.0.0.1:4747
        # on this shared VM, and EnvironmentFile is exactly how a host is meant to
        # move darius-web.service off the default port without editing the unit.
        as_user("bob", "printf 'DARIUS_WEB_PORT=4748\\n' > ~/.config/darius/web.env")
        out = as_user("bob", "XDG_RUNTIME_DIR=/run/user/1001 ~/darius/bin/darius setup --systemd --remote")
        print(out)
        unit = machine.succeed("cat /home/bob/.config/systemd/user/darius-run-due.service")
        print(unit)
        assert "@PATH@" not in unit and "@DARIUS@" not in unit, unit
        assert "/etc/profiles/per-user/bob/bin" in unit, unit
        assert "/run/current-system/sw/bin" in unit, unit
        timer = machine.succeed("cat /home/bob/.config/systemd/user/darius-run-due.timer")
        assert "OnCalendar=*:05/15" in timer, timer
        for t in TIMERS:
            user_ctl("bob", f"is-active {t}.timer")

    with subtest("bob: darius-web.service is up on its own port and answers healthz"):
        user_ctl("bob", "is-active darius-web.service")
        machine.wait_until_succeeds("curl -sf http://127.0.0.1:4748/healthz | grep -q ok")

    with subtest("bob: every unit once, as its timer would"):
        as_user("bob", "~/.local/bin/darius selftest seed")
        # bob's login PATH has no ~/.local/bin (plain NixOS), and a check's
        # login shell replaces PATH. darius must still be callable in a check.
        print(add_store_vigil("bob", "darius-selftest", "calls-darius", "A check calls darius", "darius --version"))
        for unit in ["darius-vigil-sweep", "darius-run-due", "darius-sync", "darius-snapshot"]:
            run_unit("bob", unit)
        check_selftest("bob", "~/.local/bin/darius")
        calls = vigil_status("bob", "darius-selftest", "calls-darius")
        print(calls)
        assert calls["state"] == "closed" and calls.get("verdict") == "held", calls

    with subtest("bob: the sweep runs Commands in the linked checkout, once a day"):
        as_user("bob", "mkdir -p ~/ws/sub && touch ~/ws/here.txt")
        as_user("bob", "printf 'v = 1\\nproject = \"vm-ws\"\\n' > ~/ws/.darius.toml")
        out = as_user("bob", "cd ~/ws/sub && ~/.local/bin/darius link")
        print(out)
        assert "linked vm-ws to /home/bob/ws" in out, out
        print(add_store_vigil("bob", "vm-ws", "in-checkout", "Runs in the checkout", "test -f here.txt"))
        run_unit("bob", "darius-vigil-sweep")
        here = vigil_status("bob", "vm-ws", "in-checkout")
        print(here)
        assert here["state"] == "closed" and here.get("verdict") == "held", here
        # The timer again, the same day: the project's daily lease is done.
        run_unit("bob", "darius-vigil-sweep")
        journal = machine.succeed("journalctl --no-pager -o cat _UID=1001 _SYSTEMD_USER_UNIT=darius-vigil-sweep.service")
        assert '"project":"vm-ws","reason":"swept-today"' in journal, journal

    with subtest("bob: a v3 marker is reconciled; its ritual is due at `at`, not before (0.54.0)"):
        def write_v3(slug, when):
            # `when` is a date(1) -d phrase. The grid starts on that instant's UTC date,
            # so the occurrence is exactly that instant, whatever time the VM clock shows.
            skill = f"---\nname: {slug}\ndescription: test\n---\nDo it.\n"
            marker = (
                'v = 3\nproject = "vm-v3"\nmax_mode = "report"\ntz = "UTC"\n\n'
                f'[rituals.{slug}]\ntitle = "V3 test"\ncadence = "1d"\n'
                f"from = \"$(date -u -d '{when}' +%F)\"\nat = \"$(date -u -d '{when}' +%H:%M)\"\n"
                f'skill = "{slug}"\nmode = "report"\nmay = ["Bash(date)"]\n'
            )
            as_user("bob", f"mkdir -p ~/ws3/.claude/skills/{slug} && cat > ~/ws3/.claude/skills/{slug}/SKILL.md <<'EOF'\n{skill}EOF")
            # An unquoted heredoc, so $(date ...) expands.
            as_user("bob", f"cat > ~/ws3/.darius.toml <<EOF\n{marker}EOF")

        def due_entries():
            report = json.loads(as_user("bob", "~/.local/bin/darius run-due --dry-run --project vm-v3 --json"))
            return report["projects"][0]["rituals"]

        as_user("bob", "mkdir -p ~/ws3")
        write_v3("soon", "1 minute ago")
        print(as_user("bob", "cd ~/ws3 && ~/.local/bin/darius link"))
        out = as_user("bob", "cd ~/ws3 && ~/.local/bin/darius ritual reconcile")
        print(out)
        assert "1 adopted" in out, out
        entries = due_entries()
        print(entries)
        assert [(e["slug"], e["action"]) for e in entries] == [("soon", "would-start")], entries
        # The marker now holds a ritual due in an hour. The old one left the file and is retired.
        write_v3("later", "1 hour")
        out = as_user("bob", "cd ~/ws3 && ~/.local/bin/darius ritual reconcile")
        print(out)
        assert "1 adopted" in out and "1 retired" in out, out
        entries = due_entries()
        print(entries)
        assert entries == [], entries

    with subtest("bob: a second setup --systemd changes nothing"):
        out = as_user("bob", "XDG_RUNTIME_DIR=/run/user/1001 ~/darius/bin/darius setup --systemd")
        print(out)
        assert "unchanged" in out, out
  '';
}
