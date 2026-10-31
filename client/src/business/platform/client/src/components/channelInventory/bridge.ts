// Adapter for archive-recovered channel components. It deliberately reuses the
// candidate application's authenticated tRPC client and shared UI primitives.
export { trpc } from "../../../../../api/business-trpc";
export {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
export { Button } from "../ui/button";
