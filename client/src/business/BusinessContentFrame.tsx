import { useEffect, type ReactNode } from "react";
import { BUSINESS_PORTAL_ROOT_ID } from "./BusinessPortal";
import "./BusinessNativeTypography.css";
import "./BusinessInboundNativeStyles.css";
import "./BusinessOutboundNativeStyles.css";

/**
 * Original business pages retain their content/forms. Dashboard remains the
 * only outer chrome; the body marker exists solely while this frame is mounted
 * so Radix portals retain front-office typography without restyling admin UI.
 */
export default function BusinessContentFrame({
  children,
}: {
  children: ReactNode;
}) {
  useEffect(() => {
    document.body.dataset.businessNativeFonts = "true";
    return () => {
      delete document.body.dataset.businessNativeFonts;
    };
  }, []);

  return (
    <>
      <div className="business-native-content min-h-full w-full bg-background text-foreground">
        {children}
      </div>
      <div id={BUSINESS_PORTAL_ROOT_ID} className="business-native-portals" />
    </>
  );
}
