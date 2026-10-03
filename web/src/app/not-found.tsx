import { Frame } from "@/components/shell/Frame";
import { Gate } from "@/components/shell/Gate";
import { LinkButton } from "@/components/ui/Button";

export const metadata = { title: "Nothing here" };

/**
 * An address no screen answers. It is drawn in the frame, so the sidebar is
 * there to go on from; the frame asks who is looking as on any screen, so a
 * visitor who is not signed in is sent to sign in rather than told what
 * addresses exist.
 */
export default function NotFound() {
  return (
    <Frame>
      <Gate kind="not-found">
        <LinkButton href="/" variant="primary" icon="home">
          Back to the desk
        </LinkButton>
      </Gate>
    </Frame>
  );
}
