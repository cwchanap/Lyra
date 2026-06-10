import { mount } from "svelte";
import App from "./App.svelte";

const target = document.getElementById("app");
if (!target) {
  throw new Error(
    "Layout editor failed to mount: #app element not found in document.",
  );
}
mount(App, { target });
