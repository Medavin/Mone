type Clinic = {
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  contact_name: string | null;
  contact_title: string | null;
};

/** "12 High St, Pasadena, CA 91101" from whichever parts are filled in. */
function formatAddress(clinic: Clinic) {
  const cityLine = [clinic.city, clinic.state].filter(Boolean).join(", ");
  return [clinic.street, cityLine, clinic.zip].filter(Boolean).join(", ");
}

export function ContactCard({ clinic }: { clinic: Clinic }) {
  const address = formatAddress(clinic);
  const contact = [clinic.contact_name, clinic.contact_title]
    .filter(Boolean)
    .join(", ");

  // Nothing recorded yet — say so once rather than printing four dashes.
  if (!address && !contact && !clinic.phone && !clinic.email) {
    return (
      <p className="muted">No contact details recorded for this clinic.</p>
    );
  }

  return (
    <dl className="contact">
      {address ? (
        <div>
          <dt>Address</dt>
          <dd>{address}</dd>
        </div>
      ) : null}
      {contact ? (
        <div>
          <dt>Contact</dt>
          <dd>{contact}</dd>
        </div>
      ) : null}
      {clinic.phone ? (
        <div>
          <dt>Phone</dt>
          <dd>
            <a href={`tel:${clinic.phone.replace(/[^\d+]/g, "")}`}>
              {clinic.phone}
            </a>
          </dd>
        </div>
      ) : null}
      {clinic.email ? (
        <div>
          <dt>Email</dt>
          <dd>
            <a href={`mailto:${clinic.email}`}>{clinic.email}</a>
          </dd>
        </div>
      ) : null}
    </dl>
  );
}
