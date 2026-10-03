import { Gate } from "@/components/shell/Gate";
import { LinkButton } from "@/components/ui/Button";

/**
 * An SEO page the owner has not given this person: the access gate with the
 * server's own sentence, where the page would be.
 *
 * Drawn in place, not thrown. The frame's error screen sits above the SEO
 * layout, so a throw would also take away the head and the tabs of the SEO
 * pages they do have, and in production it would lose the sentence.
 */
export function SeoRefused({ message }: { message: string }) {
  return (
    <Gate kind="forbidden" detail={message}>
      <LinkButton href="/" variant="primary" icon="home">
        Back to the desk
      </LinkButton>
    </Gate>
  );
}
