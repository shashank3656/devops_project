import { serviceLabel, servicesForCloud } from '../lib/cloudServices';

type CloudServiceSelectProps = {
  cloud: string;
  selected: string[];
  onToggle: (cloud: string, service: string) => void;
};

export default function CloudServiceSelect({ cloud, selected, onToggle }: CloudServiceSelectProps) {
  const services = servicesForCloud(cloud);
  return (
    <div className="form-group">
      <label className="label" htmlFor={`service-${cloud}`}>{cloud.toUpperCase()} service</label>
      <select
        id={`service-${cloud}`}
        className="select"
        value=""
        onChange={(event) => {
          if (event.target.value) onToggle(cloud, event.target.value);
        }}
      >
        <option value="">Select a service</option>
        {services.map((service) => (
          <option key={service.id} value={service.id} disabled={selected.includes(service.id)}>
            {service.label}
          </option>
        ))}
      </select>
      {selected.length > 0 ? (
        <div className="catalog-editor__choice-row">
          {selected.map((id) => (
            <button key={id} type="button" className="btn btn-secondary btn-sm" onClick={() => onToggle(cloud, id)}>
              {serviceLabel(cloud, id)} · remove
            </button>
          ))}
        </div>
      ) : (
        <p className="catalog-editor__section-copy">Select a service for {cloud.toUpperCase()}. It is saved on this project.</p>
      )}
    </div>
  );
}
