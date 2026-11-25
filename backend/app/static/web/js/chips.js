import { h, normalizeTags } from "./utils.js";
import { hueOf } from "./utils.js";

/** Tag input: Enter or comma adds a chip, Backspace removes the last one. */
export function chipInput({ initial = [], suggestions = [], onEnterEmpty } = {}) {
  let tags = normalizeTags(initial);
  const input = h("input", { placeholder: "Add tag…", autocomplete: "off", list: "tag-suggestions" });
  const list = h("datalist", { id: "tag-suggestions" }, suggestions.map((s) => h("option", { value: s })));
  const box = h("div", { class: "chips" }, input, list);
  box.addEventListener("click", () => input.focus());

  function render() {
    box.querySelectorAll(".tag").forEach((el) => el.remove());
    for (const t of tags) {
      const chip = h("span", { class: "tag", style: { "--h": hueOf(t) } }, t,
        h("button", { type: "button", "aria-label": `Remove ${t}`, onclick: () => { tags = tags.filter((v) => v !== t); render(); } }, "×"));
      box.insertBefore(chip, input);
    }
  }
  function commit() {
    const parts = input.value.split(",");
    if (parts.some((p) => p.trim())) { tags = normalizeTags([...tags, ...parts]); render(); }
    input.value = "";
  }
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (input.value.trim()) commit();
      else onEnterEmpty?.();
    } else if (e.key === ",") { e.preventDefault(); commit(); }
    else if (e.key === "Backspace" && !input.value && tags.length) { tags.pop(); render(); }
  });
  input.addEventListener("change", commit);
  render();
  return { el: box, get: () => { commit(); return [...tags]; }, set: (v) => { tags = normalizeTags(v); render(); }, focus: () => input.focus() };
}
