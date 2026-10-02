import { Icon } from "@/components/ui/icons";

/** Said across the top whenever the screen is fed specimen rows (?specimen=1, on a development copy only). */
export function Ribbon() {
  return (
    <p className="dk-operator-ribbon" role="note">
      <Icon name="flask" size={16} />
      <span>
        <b>Specimen data.</b> The tasks, the answer, the recent actions and the proposals on this screen are made up, to show the connected state. The website
        context, the drafts and the to-do list are real. Nothing can be queued or approved from this view.
      </span>
    </p>
  );
}
