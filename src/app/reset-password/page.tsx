import { Suspense } from "react";
import { ResetPasswordScreen } from "@/components/ResetPasswordScreen";

export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  // ResetPasswordScreen uses useSearchParams, which Next requires to be
  // wrapped in <Suspense> so the static-shell can render while the
  // client reads the URL.
  return (
    <Suspense fallback={null}>
      <ResetPasswordScreen />
    </Suspense>
  );
}
