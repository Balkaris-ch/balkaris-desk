import type { SeoBacklinksPayload } from "@/contract/seo/backlinks";
import { Badge, Chip } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Absent } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { hrefWith, paramsOf, taskAnchor, taskTitle, variantTone } from "./look";

const FIELD_LABEL = { name: "Name", address: "Address", phone: "Phone" } as const;

/**
 * "Name, address, phone": each field with every value in use and the
 * profiles that state it. One value per field is the aim; which one is true
 * is the owner's decision, so the panel never picks one, it points to the
 * step that decides.
 */
export function Nap({ data, range }: { data: SeoBacklinksPayload; range: string }) {
  const r = data.nap;
  const base = paramsOf(range, data.asked);
  return (
    <Card
      title="Name, address, phone"
      icon="map-pin"
      tone={r.state === "ok" && !r.value.consistent ? "bad" : "good"}
      sub="The same three on every profile, or search engines and AI assistants read two businesses."
      info={r.state === "ok" ? r.value.rule : "Name, address and phone as each profile states them."}
      right={r.state === "ok" ? <Badge tone={r.value.consistent ? "good" : "bad"} dot>{r.value.consistent ? "Consistent" : "Inconsistent"}</Badge> : undefined}
      className="dk-seo-bl-napcard"
      footer={r.state === "ok" ? <Stamp reading={r} /> : undefined}
    >
      {r.state === "ok" ? (
        <div className="dk-seo-bl-napgrid">
          {r.value.groups.map((g) => {
            const only = g.variants.length <= 1;
            return (
              <section key={g.field} className="dk-seo-bl-napfield">
                <header className="dk-seo-bl-napfield-head">
                  <h3>{FIELD_LABEL[g.field]}</h3>
                  {g.variants.length ? (
                    <span className={only ? "dk-seo-bl-good" : "dk-seo-bl-bad"}>{only ? "one value" : `${g.variants.length} values in use`}</span>
                  ) : (
                    <span className="dk-seo-bl-quiet">stated nowhere</span>
                  )}
                </header>
                <ul className="dk-seo-bl-variants">
                  {g.variants.map((v) => (
                    <li key={v.variant}>
                      <Chip tone={variantTone(v.variant, only)} className="dk-seo-bl-variant">
                        {v.variant}
                      </Chip>
                      <span className="dk-seo-bl-variant-text">
                        <span className="dk-seo-bl-variant-value">{v.value}</span>
                        <span className="dk-seo-bl-quiet">{v.sources.join(" · ")}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          {r.value.decision ? (
            <Go href={hrefWith(base, { task: r.value.decision.id }, taskAnchor(r.value.decision.id))} className="dk-seo-bl-decision">
              <Icon name={r.value.decision.done ? "check-circle" : "flag"} size={15} />
              <span>
                <b>{r.value.decision.done ? "Decided" : "Needs you"}:</b> {taskTitle(r.value.decision.title)}. Every listing copies the answer.
              </span>
              <Icon name="chevron-right" size={14} />
            </Go>
          ) : null}
        </div>
      ) : (
        <Absent reading={r} />
      )}
    </Card>
  );
}
