const formatFiles = (files) =>
  files.map((file) => JSON.stringify(file)).join(" ");

export default {
  "*.{js,cjs,mjs,ts,svelte}": (files) => [
    "bun run --cwd apps/game sync",
    `eslint --fix ${formatFiles(files)}`,
    `prettier --write --ignore-unknown ${formatFiles(files)}`,
  ],
  "*.{css,html,json,md,yml,yaml}": (files) =>
    `prettier --write --ignore-unknown ${formatFiles(files)}`,
  "apps/game/src-tauri/**/*.rs": () => [
    "cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml --all",
    "cargo clippy --manifest-path apps/game/src-tauri/Cargo.toml --all-targets --all-features -- -D warnings",
  ],
  "apps/layout-editor/src-tauri/**/*.rs": () => [
    "cargo fmt --manifest-path apps/layout-editor/src-tauri/Cargo.toml --all",
    "cargo clippy --manifest-path apps/layout-editor/src-tauri/Cargo.toml --all-targets --all-features -- -D warnings",
  ],
};
