import { notFound } from "next/navigation";
import { FormattingPreview } from "./preview";

// Dev-only gallery of every chat answer format, rendered through the
// same <Markdown> the chat uses. Not reachable in production.
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <FormattingPreview />;
}
