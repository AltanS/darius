# The darius package. No build step: the TypeScript source ships as it is, and
# a pinned runtime runs it, exactly as bin/darius does in a checkout.
#
# Layout: $out/share/darius is a checkout minus the dev files, and
# $out/bin/darius links to its bin/darius. That keeps one invariant the code
# relies on: src/runner/launch.ts finds the hook command at ../../bin/darius
# from its own file, so the PreToolUse hook runs this same package.
{
  lib,
  stdenvNoCC,
  makeWrapper,
  bash,
  # nixpkgs' `bash` is the interactive build (readline, ncurses). Older
  # nixpkgs have no bashNonInteractive; there, plain bash it is.
  bashNonInteractive ? bash,
  coreutils,
  gnused,
  bun,
  nodejs_24,
  runtime ? "bun",
}:

assert lib.assertOneOf "runtime" runtime [
  "bun"
  "node"
];

let
  packageJson = lib.importJSON ../package.json;
  js = if runtime == "bun" then bun else nodejs_24;
  runtimeVar = if runtime == "bun" then "DARIUS_BUN" else "DARIUS_NODE";
in
stdenvNoCC.mkDerivation {
  pname = "darius";
  inherit (packageJson) version;

  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../bin
      ../scripts/run.sh
      ../src
      ../systemd
      # The web app's committed build: hosts never build it (docs/concept.md,
      # "Web status page" > "Build").
      ../web/build
      ../package.json
      ../LICENSE
    ];
  };

  nativeBuildInputs = [ makeWrapper ];
  # patchShebangs --host takes bash from here, so no script needs bash on PATH.
  buildInputs = [ bashNonInteractive ];

  dontConfigure = true;
  dontBuild = true;

  installPhase = ''
    runHook preInstall

    mkdir -p $out/share/darius $out/bin
    cp -r bin scripts src systemd package.json $out/share/darius/
    mkdir -p $out/share/darius/web
    cp -r web/build $out/share/darius/web/
    install -Dm644 LICENSE $out/share/licenses/darius/LICENSE
    patchShebangs --host $out/share/darius/bin $out/share/darius/scripts

    # --set-default, not --set: DARIUS_RUNTIME and DARIUS_BUN / DARIUS_NODE
    # still override from the environment. The launcher scripts call dirname,
    # readlink and sed, and vigil checks run in bash, so those go LAST on PATH:
    # a fallback when the caller's PATH has none, never a shadow of the host's.
    wrapProgram $out/share/darius/bin/darius \
      --set-default DARIUS_RUNTIME ${runtime} \
      --set-default ${runtimeVar} ${lib.getExe js} \
      --suffix PATH : ${
        lib.makeBinPath [
          bashNonInteractive
          coreutils
          gnused
        ]
      }
    ln -s $out/share/darius/bin/darius $out/bin/darius

    runHook postInstall
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    HOME="$TMPDIR" PATH= $out/bin/darius --version | grep -Fx "darius ${packageJson.version} (${runtime})"
    test -f $out/share/darius/web/build/server/index.js
    runHook postInstallCheck
  '';

  passthru = { inherit runtime; };

  meta = {
    inherit (packageJson) description;
    homepage = "https://github.com/AltanS/darius";
    license = lib.licenses.mit;
    mainProgram = "darius";
    platforms = js.meta.platforms;
  };
}
