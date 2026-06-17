// Build-time (SSR) injection of a copy button into every markdown <pre> block.
// The icon + states are pure CSS (see .copy-btn in global.css); a small client
// script in Doc.astro wires the click. No client JS renders the icon.
export default function rehypeCopyButton() {
  return (tree) => {
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      if (node.type === "element" && node.tagName === "pre") {
        node.children = node.children || [];
        node.children.push({
          type: "element",
          tagName: "button",
          properties: {
            type: "button",
            className: ["copy-btn", "copy-btn--prose"],
            "aria-label": "Copy code",
          },
          children: [],
        });
        return; // don't descend into the <pre>
      }
      if (Array.isArray(node.children)) node.children.forEach(walk);
    };
    walk(tree);
  };
}
