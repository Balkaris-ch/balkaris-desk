import { Icon } from "@/components/ui/icons";

/** Across the top of a screen drawn with ?specimen=1: the panels whose source is not connected hold made-up rows. */
export function SpecimenRibbon() {
  return (
    <p className="dk-overview-ribbon" role="note">
      <Icon name="flask" size={16} />
      <span>
        <b>Specimen data.</b> Leads, Organic clicks, Indexed pages, the Search Console and engine rules, the enquiry column and the lab speed cells hold made-up figures,
        to show their connected state. The development copy only; the real desk never draws this.
      </span>
    </p>
  );
}
