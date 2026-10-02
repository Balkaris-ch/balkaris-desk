import { Icon } from "@/components/ui/icons";

/** The ribbon over the screen when panels hold specimen rows (?specimen=1, development only): it names them. */
export function SpecimenRibbon({ panels }: { panels: string[] }) {
  return (
    <p className="dk-hosting-specimen" role="note">
      <Icon name="flask" size={15} />
      <span>
        <b>Specimen data.</b> These panels show artificial values to preview their connected state: {panels.join(", ")}. They are not measurements of the website.
      </span>
    </p>
  );
}
