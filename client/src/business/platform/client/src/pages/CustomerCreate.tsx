import { useEffect } from "react";
import { useLocation } from "wouter";

/** Keep bookmarks and existing links working after entry merges into the list. */
export default function CustomerCreate() {
  const [, navigate] = useLocation();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("create", "1");
    navigate(`/customers?${params}`, { replace: true });
  }, [navigate]);
  return null;
}
