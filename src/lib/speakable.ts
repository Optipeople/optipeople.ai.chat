// Turns an assistant answer into text worth reading aloud. The answer is
// Markdown with rich blocks (chart and KPI JSON, follow-up questions,
// callout markers, term chips) that sound like noise when spoken.
export function speakableText(markdown: string): string {
  return (
    markdown
      // Rich fenced blocks carry data for the screen, not for the ear.
      // An unclosed fence (cut off answer) runs to the end.
      .replace(/```(chart|kpis?|questions|followups)\b[\s\S]*?(```|$)/gi, "")
      // Other code: keep the content, drop the fence lines.
      .replace(/^```.*$/gm, "")
      .replace(/^(\s*>\s*)\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*/gim, "$1")
      // Links and chips: keep the label.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\$\$([\s\S]*?)\$\$/g, "$1")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

// Copied answers keep their Markdown, but term chips become their plain
// label: `[RESET](opti:term/button)` pastes as "RESET".
export function copyableText(markdown: string): string {
  return markdown.replace(/\[([^\]]+)\]\(opti:term\/[a-z]+\)/g, "$1");
}
