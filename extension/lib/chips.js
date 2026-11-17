import { normalizeTags } from "./store.js";

/** Tag input: Enter/comma adds a chip, Backspace removes the last one. `onEnterEmpty` fires on Enter with no text. */
export function createChipInput(container, { suggestions = [], onEnterEmpty } = {}) {
  let tags = [];
  const input = document.createElement("input");
  input.placeholder = "Add tag…";
  input.setAttribute("list", "tag-suggestions");
  input.autocomplete = "off";
  const list = document.createElement("datalist");
  list.id = "tag-suggestions";
  for (const s of suggestions) list.append(new Option(s));
  container.append(input, list);

  function render() {
    container.querySelectorAll(".chip").forEach((el) => el.remove());
    for (const t of tags) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.append(t);
      const x = document.createElement("button");
      x.type = "button";
      x.textContent = "×";
      x.setAttribute("aria-label", `Remove ${t}`);
      x.addEventListener("click", () => {
        tags = tags.filter((v) => v !== t);
        render();
      });
      chip.append(x);
      container.insertBefore(chip, input);
    }
  }

  function commit() {
    const parts = input.value.split(",");
    if (parts.some((p) => p.trim())) {
      tags = normalizeTags([...tags, ...parts]);
      render();
    }
    input.value = "";
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (input.value.trim()) commit();
      else onEnterEmpty?.();
    } else if (e.key === "," ) {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && !input.value && tags.length) {
      tags.pop();
      render();
    }
  });
  input.addEventListener("change", commit);
  container.addEventListener("click", () => input.focus());

  return {
    get: () => {
      commit();
      return [...tags];
    },
    set: (v) => {
      tags = normalizeTags(v);
      render();
    },
    focus: () => input.focus(),
  };
}
