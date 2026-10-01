# home-manager module: services.darius.
#
# It does what `darius setup --systemd` does for a checkout, declaratively:
# puts darius on PATH, optionally writes ~/.config/darius/config.toml, and
# declares the sync, vigil-sweep, run-due and snapshot units and timers with
# the same schedules as systemd/*.timer, plus the standing darius-web.service
# (services.darius.web) that runs the read-only status page.
#
# The unit PATH is spelled out here, not inherited. A user unit's environment
# is whatever the user manager has, and on NixOS that is not the login PATH.
# The units need bash (vigil checks), darius itself (the hook, and the model's
# own `darius run complete`) and claude (run-due), so they get this package
# first, then the operator's profiles, then the system. Vigil checks run in a
# login shell, and NixOS's /etc/profile replaces PATH there: a check sees the
# operator's login PATH first, as in a terminal, then these dirs.
{ self }:
{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.darius;
  inherit (lib)
    literalExpression
    mkEnableOption
    mkIf
    mkOption
    types
    ;

  home = config.home.homeDirectory;

  unitPath = lib.concatStringsSep ":" (
    lib.unique [
      "${cfg.package}/bin"
      "${home}/.local/bin"
      "${config.home.profileDirectory}/bin"
      "/etc/profiles/per-user/${config.home.username}/bin"
      "/run/wrappers/bin"
      "/nix/var/nix/profiles/default/bin"
      "/run/current-system/sw/bin"
      # Not NixOS: home-manager on another Linux.
      "/usr/local/bin"
      "/usr/bin"
      "/bin"
    ]
  );

  # darius reads a TOML subset: quoted strings with \" \\ \n \t, booleans.
  tomlString =
    s:
    assert lib.assertMsg (
      !lib.hasInfix "\n" s
    ) "services.darius.settings: values cannot hold a newline";
    ''"${lib.escape [ "\\" "\"" ] s}"'';
  tomlBool = b: if b then "true" else "false";

  configText =
    s:
    lib.concatStringsSep "\n" (
      lib.optional (s.host != null) "host = ${tomlString s.host}"
      ++ [
        ""
        "[notify]"
        "webhook = ${tomlString s.notify.webhook}"
        ""
        "[runner]"
        "claude = ${tomlString s.runner.claude}"
      ]
      ++ lib.optionals (s.remote != null) [
        ""
        "[remote]"
        "endpoint = ${tomlString s.remote.endpoint}"
        "bucket = ${tomlString s.remote.bucket}"
        "region = ${tomlString s.remote.region}"
        "path_style = ${tomlBool s.remote.path_style}"
        "allow_http = ${tomlBool s.remote.allow_http}"
        "sse = ${tomlBool s.remote.sse}"
        "credentials = ${tomlString s.remote.credentials}"
      ]
    )
    + "\n";

  remoteOptions = {
    endpoint = mkOption {
      type = types.str;
      example = "http://100.64.1.10:9910";
      description = "S3 endpoint of the bucket host.";
    };
    bucket = mkOption {
      type = types.str;
      default = "darius";
      description = "Bucket name.";
    };
    region = mkOption {
      type = types.str;
      default = "us-east-1";
      description = "SigV4 region.";
    };
    path_style = mkOption {
      type = types.bool;
      default = true;
      description = "Path-style bucket addressing. SeaweedFS needs it.";
    };
    allow_http = mkOption {
      type = types.bool;
      default = false;
      description = "Allow plain HTTP. darius accepts it only for loopback and the tailnet (100.64.0.0/10).";
    };
    sse = mkOption {
      type = types.bool;
      default = true;
      description = "Ask the server to encrypt objects at rest.";
    };
    credentials = mkOption {
      type = types.str;
      example = literalExpression "config.sops.secrets.darius-credentials.path";
      description = ''
        Path to the AWS-ini credentials file. It must be readable by its owner
        only (0600 or 0400), which is what sops-nix and agenix produce. It is a
        path, never the secret: the value lands in the Nix store.
      '';
    };
  };

  timerOptions = name: onCalendar: {
    enable = mkOption {
      type = types.bool;
      default = true;
      description = "Run `darius ${name}` on a timer.";
    };
    onCalendar = mkOption {
      type = types.str;
      default = onCalendar;
      description = "systemd OnCalendar expression.";
    };
  };

  service = description: args: extraService: {
    Unit = {
      Description = description;
      Documentation = [ "https://github.com/AltanS/darius" ];
    };
    Service = {
      Type = "oneshot";
      Environment = [ "PATH=${unitPath}" ];
      ExecStart = "${lib.getExe cfg.package} ${args}";
    }
    // extraService;
  };

  timer = description: timerConfig: {
    Unit = {
      Description = description;
      Documentation = [ "https://github.com/AltanS/darius" ];
    };
    Timer = timerConfig;
    Install.WantedBy = [ "timers.target" ];
  };

  # Unlike the timer-triggered services above, the web page is a standing
  # service: it has no timer, so it carries its own [Install] and enables
  # itself against default.target, the same as systemd/darius-web.service.
  webService = {
    Unit = {
      Description = "darius serve (read-only status page)";
      Documentation = [ "https://github.com/AltanS/darius" ];
    };
    Service = {
      Type = "simple";
      Environment = [ "PATH=${unitPath}" ] ++ lib.optional (cfg.web.allow != [ ]) "DARIUS_WEB_ALLOW=${lib.concatStringsSep "," cfg.web.allow}";
      ExecStart = "${lib.getExe cfg.package} serve --bind ${lib.escapeShellArg cfg.web.bind} --port ${toString cfg.web.port}";
      Restart = "on-failure";
      RestartSec = 5;
    };
    Install.WantedBy = [ "default.target" ];
  };
in
{
  options.services.darius = {
    enable = mkEnableOption "darius, the ritual and vigil tracker, with its timers";

    package = mkOption {
      type = types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.darius;
      defaultText = literalExpression "darius.packages.\${system}.darius";
      description = "The darius package. `darius-node` runs the same code on Node.";
    };

    settings = mkOption {
      default = null;
      description = ''
        Contents of ~/.config/darius/config.toml. null leaves that file to you
        (`darius setup` writes a skeleton). Everything here lands in the Nix
        store, so put no secret in it: the webhook URL, if it is one, belongs
        in a file you write yourself.
      '';
      type = types.nullOr (
        types.submodule {
          options = {
            host = mkOption {
              type = types.nullOr types.str;
              default = null;
              description = "Host name in ledger lines. null: the short hostname.";
            };
            notify.webhook = mkOption {
              type = types.str;
              default = "";
              description = "Webhook for held runs. Empty: none.";
            };
            runner.claude = mkOption {
              type = types.str;
              default = "";
              description = "Claude Code executable for run-due. Empty: `claude` on the unit PATH.";
            };
            remote = mkOption {
              type = types.nullOr (types.submodule { options = remoteOptions; });
              default = null;
              description = "The bucket. null: no sync.";
            };
          };
        }
      );
    };

    sync = timerOptions "sync --all-projects" "*:0/15" // {
      enable = mkOption {
        type = types.bool;
        default = cfg.settings != null && cfg.settings.remote != null;
        defaultText = literalExpression "settings.remote != null";
        description = ''
          Run `darius sync --all-projects` on a timer. Off without a remote,
          where every run would fail.
        '';
      };
    };

    vigilSweep = timerOptions "vigil sweep --all-projects --daily" "06:30";

    snapshot = timerOptions "snapshot create" "04:00";

    runDue = timerOptions "run-due --unattended" "*:05" // {
      slice = mkOption {
        type = types.nullOr types.str;
        default = null;
        example = "claude.slice";
        description = "systemd slice for run-due and the claude sessions it starts.";
      };
    };

    web = {
      enable = mkOption {
        type = types.bool;
        default = false;
        description = ''
          Run `darius serve`, the read-only status page, as a standing user
          service. Off by default: with bind "auto" the page also listens on
          the tailnet, and a host should opt in to a new listener. Turn it on
          for the host you look at; a sync-only host needs none.
        '';
      };
      bind = mkOption {
        type = types.str;
        default = "auto";
        example = "127.0.0.1,100.64.1.10";
        description = ''
          Addresses `darius serve` listens on: "auto" (loopback plus this
          host's tailnet address, once Tailscale has one), one address, or a
          comma list. Never "0.0.0.0" or "::". A tailnet caller must be a
          device of an allowed Tailscale login (`allow`, default: the owner
          of this host); tagged devices and other users get 403.
        '';
      };
      port = mkOption {
        type = types.port;
        default = 4747;
        description = "Port `darius serve` listens on.";
      };
      allow = mkOption {
        type = types.listOf types.str;
        default = [ ];
        example = [ "owner" ];
        description = "Tailscale logins whose devices may see the page. Empty: the login that owns this host.";
      };
    };
  };

  config = mkIf cfg.enable (
    lib.mkMerge [
      {
        home.packages = [ cfg.package ];
        assertions = [
          {
            assertion = !(cfg.web.enable && lib.any (bind: bind == "0.0.0.0" || bind == "::") (lib.splitString "," cfg.web.bind));
            message = ''
              services.darius.web.bind must not be "0.0.0.0" or "::": darius
              serve has no login, so it must not listen on every interface.
              Use "127.0.0.1" or this host's tailnet address.
            '';
          }
        ];
      }

      (mkIf (cfg.settings != null) {
        home.file.".config/darius/config.toml".text = configText cfg.settings;
      })

      (mkIf pkgs.stdenv.hostPlatform.isLinux {
        systemd.user.services = lib.mkMerge [
          (mkIf cfg.sync.enable {
            darius-sync = service "darius sync --all-projects" "sync --all-projects --json" { };
          })
          (mkIf cfg.vigilSweep.enable {
            darius-vigil-sweep =
              service "darius vigil sweep --all-projects --daily" "vigil sweep --all-projects --daily --json"
                { };
          })
          (mkIf cfg.snapshot.enable {
            # snapshot.env is where DARIUS_SNAPSHOT_* settings live; the web
            # service reads it too, as in systemd/darius-snapshot.service.
            darius-snapshot = service "darius snapshot" "snapshot create --json" {
              EnvironmentFile = "-%h/.config/darius/snapshot.env";
            };
          })
          (mkIf cfg.runDue.enable {
            darius-run-due = service "darius run-due --unattended" "run-due --unattended --json" (
              lib.optionalAttrs (cfg.runDue.slice != null) { Slice = cfg.runDue.slice; }
            );
          })
          (mkIf cfg.web.enable { darius-web = webService; })
        ];

        # Same schedules as systemd/*.timer in this repo.
        systemd.user.timers = lib.mkMerge [
          (mkIf cfg.sync.enable {
            darius-sync = timer "Run darius sync every 15 minutes" {
              OnCalendar = cfg.sync.onCalendar;
              AccuracySec = "1min";
            };
          })
          (mkIf cfg.vigilSweep.enable {
            darius-vigil-sweep = timer "Run darius vigil sweep once a day" {
              OnCalendar = cfg.vigilSweep.onCalendar;
              Persistent = true;
              AccuracySec = "5min";
            };
          })
          (mkIf cfg.snapshot.enable {
            darius-snapshot = timer "Run darius snapshot once a day" {
              OnCalendar = cfg.snapshot.onCalendar;
              RandomizedDelaySec = "10min";
              Persistent = true;
              AccuracySec = "5min";
            };
          })
          (mkIf cfg.runDue.enable {
            darius-run-due = timer "Run darius run-due once an hour" {
              OnCalendar = cfg.runDue.onCalendar;
              Persistent = true;
              AccuracySec = "1min";
            };
          })
        ];
      })
    ]
  );
}
