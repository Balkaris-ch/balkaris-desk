import { Gate } from "@/components/shell/Gate";
import { LinkButton } from "@/components/ui/Button";

/** A screen that called `notFound()`: the thing it was asked for is not there. Drawn inside the frame. */
export default function FrameNotFound() {
  return (
    <Gate kind="not-found">
      <LinkButton href="/" variant="primary" icon="home">
        Back to the desk
      </LinkButton>
    </Gate>
  );
}
