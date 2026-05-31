const formatFiles = (files) =>
  files.map((file) => JSON.stringify(file)).join(" ");

export default {
  "*.{js,cjs,mjs,ts,svelte}": (files) => [
    "svelte-kit sync",
    `eslint --fix ${formatFiles(files)}`,
    `prettier --write --ignore-unknown ${formatFiles(files)}`,
  ],
  "*.{css,html,json,md,yml,yaml}": (files) =>
    `prettier --write --ignore-unknown ${formatFiles(files)}`,
  "src-tauri/**/*.rs": () => [
    "cargo fmt --manifest-path src-tauri/Cargo.toml --all",
    "cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings",
  ],
};
