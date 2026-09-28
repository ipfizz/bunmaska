// Build-time copy button for every markdown <pre>, so the icon ships in the SSR'd HTML;
// Base.astro wires the click. The button sits beside the <pre>, not inside it,
// so it stays put while a wide block scrolls.
export default function rehypeCopyButton() {
  return (tree) => {
    const walk = (node) => {
      if (!Array.isArray(node?.children)) return;
      node.children = node.children.map((child) => {
        if (child.type !== "element" || child.tagName !== "pre") {
          walk(child);
          return child;
        }
        return {
          type: "element",
          tagName: "div",
          properties: { className: ["pre-wrap"] },
          children: [
            child,
            {
              type: "element",
              tagName: "button",
              properties: {
                type: "button",
                className: ["copy-btn", "copy-btn--prose"],
                "aria-label": "Copy code",
              },
              children: [],
            },
          ],
        };
      });
    };
    walk(tree);
  };
}
