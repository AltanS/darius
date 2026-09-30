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
  src,
}:

stdenvNoCC.mkDerivation {
  name = "darius-tests";

  src = lib.fileset.toSource {
    root = src;
    fileset = lib.fileset.unions [
      (src + "/bin")
      (src + "/scripts")
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
    export HOME="$TMPDIR/home"
    mkdir -p "$HOME"
    bash scripts/test.sh
    runHook postBuild
  '';

  installPhase = ''
    touch $out
  '';
}
