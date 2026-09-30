{
  # darius as a Nix flake: the package, a dev shell, a home-manager module that
  # declares the three timers, and checks that prove it on a real NixOS.
  #
  # The flake is additive. `git clone` + `bin/darius setup --systemd` stays a
  # supported install on every Linux, NixOS included. The flake is the
  # declarative path for a Nix host.
  #
  # THE COMMITTED flake.lock IS THE PIN. Bump it on purpose (`nix flake update`,
  # then `nix flake check`), never as a side effect.
  description = "darius: rituals, vigils and milestones for agent-driven projects";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    # Only the NixOS VM test (checks.<system>.nixos) uses home-manager. A
    # consumer that has its own copy can share it:
    #   inputs.darius.inputs.home-manager.follows = "home-manager";
    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      home-manager,
    }:
    let
      inherit (nixpkgs) lib;
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = f: lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forAllSystems (pkgs: rec {
        # Bun is the default runtime, as everywhere else. darius-node is the
        # same code on Node 24, for a closure without Bun.
        darius = pkgs.callPackage ./nix/package.nix { };
        darius-node = darius.override { runtime = "node"; };
        default = darius;
      });

      apps = forAllSystems (pkgs: {
        default = {
          type = "app";
          program = lib.getExe self.packages.${pkgs.stdenv.hostPlatform.system}.darius;
          meta.description = "darius CLI";
        };
      });

      overlays.default = final: _prev: {
        darius = final.callPackage ./nix/package.nix { };
      };

      homeManagerModules.default = import ./nix/hm-module.nix { inherit self; };
      # The newer home-manager name for the same output.
      homeModules.default = self.homeManagerModules.default;

      devShells = forAllSystems (pkgs: {
        # Both runtimes, because both must keep working. oxlint and TypeScript
        # come from `bun install` (package.json pins them), not from nixpkgs.
        default = pkgs.mkShell {
          name = "darius-dev";
          packages = [
            pkgs.bun
            pkgs.nodejs_24
            pkgs.git
          ];
          shellHook = ''
            echo "darius dev shell: bun $(bun --version), node $(node --version). Run 'bun install' once for oxlint and tsc."
          '';
        };
      });

      checks = forAllSystems (
        pkgs:
        let
          system = pkgs.stdenv.hostPlatform.system;
          packages = self.packages.${system};
        in
        {
          darius = packages.darius;
          darius-node = packages.darius-node;
          # The node:test suite and the runtime matrix, in the build sandbox.
          # The real-S3 tests skip there (no podman); the VM test covers sync.
          tests = pkgs.callPackage ./nix/tests/suite.nix { src = ./.; };
        }
        // lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
          # Boots NixOS, installs darius twice (home-manager module, and a plain
          # checkout with `darius setup --systemd`), and runs every unit.
          nixos = import ./nix/tests/vm.nix { inherit self pkgs home-manager; };
        }
      );

      formatter = forAllSystems (pkgs: pkgs.nixfmt);
    };
}
