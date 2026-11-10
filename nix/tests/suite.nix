# The node:test suite and the runtime matrix (scripts/test.sh) in the build
# sandbox. No network and no podman there, so the real-S3 tests skip loudly;
# the NixOS VM test (vm.nix) covers sync against a real SeaweedFS.
{
  lib,
  stdenvNoCC,
  bash,
  bun,
  nodejs_24,
  git,
  procps,
  cacert,
  src,
}:

let
  # The web app's runtime packages (react, react-router, ...), for the web-*.test.ts
  # files and agenda.test.ts, which import web/app/lib/*.ts. A checkout gets them from
  # `(cd web && bun install)`; the build sandbox has no network, so this fixed-output
  # derivation fetches them (fixed-output derivations may use the network) and the hash
  # pins the result. Production packages only: they are plain JavaScript, so the hash
  # is the same on every system. The dev tools (vite, tsc, ...) are not needed to test.
  #
  # WHEN web/bun.lock OR web/package.json CHANGE, the build fails with a hash mismatch.
  # Copy the `got:` hash from the error into outputHash.
  webDeps = stdenvNoCC.mkDerivation {
    name = "darius-web-deps";
    src = lib.fileset.toSource {
      root = src + "/web";
      fileset = lib.fileset.unions [
        (src + "/web/package.json")
        (src + "/web/bun.lock")
      ];
    };
    nativeBuildInputs = [ bun ];
    dontConfigure = true;
    buildPhase = ''
      runHook preBuild
      export HOME="$TMPDIR/home"
      export SSL_CERT_FILE=${cacert}/etc/ssl/certs/ca-bundle.crt
      export BUN_INSTALL_CACHE_DIR="$TMPDIR/bun-cache"
      mkdir -p "$HOME"
      bun install --frozen-lockfile --production --ignore-scripts --backend=copyfile
      runHook postBuild
    '';
    installPhase = ''
      mkdir -p $out
      cp -r node_modules $out/node_modules
    '';
    dontFixup = true;
    outputHashMode = "recursive";
    outputHashAlgo = "sha256";
    outputHash = "sha256-A9thoto6BO+XpbLMqtOhjDfwCPrkxQQKgfuyufxlpgk=";
  };
in
stdenvNoCC.mkDerivation {
  name = "darius-tests";

  src = lib.fileset.toSource {
    root = src;
    fileset = lib.fileset.unions [
      # The mail logo: test/mail-shell.test.ts reads the PNG. The installed darius
      # does not: a mail only names its URL on GitHub, so nix/package.nix leaves it out.
      (src + "/assets/email")
      (src + "/bin")
      (src + "/scripts")
      # The static skill text: test/skill*.test.ts install it.
      (src + "/skills")
      (src + "/src")
      (src + "/systemd")
      (src + "/test")
      # The committed web build and its inputs: test/web-build.test.ts hashes
      # the inputs, test/web-app.test.ts renders the build.
      (src + "/web")
      (src + "/package.json")
    ];
  };

  # procps: the timeout tests look for survivors with pgrep.
  nativeBuildInputs = [
    bash
    bun
    nodejs_24
    git
    procps
  ];

  dontConfigure = true;

  buildPhase = ''
    runHook preBuild
    patchShebangs bin scripts
    # The web tests resolve react from web/node_modules, as in a checkout.
    cp -r ${webDeps}/node_modules web/node_modules
    export HOME="$TMPDIR/home"
    mkdir -p "$HOME"
    bash scripts/test.sh
    runHook postBuild
  '';

  installPhase = ''
    touch $out
  '';

  # `nix build .#checks.<system>.tests.webDeps` builds the packages alone, to read the hash.
  passthru = { inherit webDeps; };
}
