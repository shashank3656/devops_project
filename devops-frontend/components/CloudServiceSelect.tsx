import { useState } from 'react';
import { serviceLabel, servicesForCloud } from '../lib/cloudServices';

type CloudServiceSelectProps = {
  cloud: string;
  selected: string[];
  onToggle: (cloud: string, service: string) => void;
};

export default function CloudServiceSelect({ cloud, selected, onToggle }: CloudServiceSelectProps) {
  const [query, setQuery] = useState('');
  const services = servicesForCloud(cloud);
  const needle = query.trim().toLowerCase();
  const visible = services.filter((service) => service.label.toLowerCase().includes(needle));
  const cloudName = cloud.toUpperCase();

  return (
    <div className="cloud-service-picker">
      <div className="cloud-service-picker__head">
        <strong>{cloudName} services</strong>
        <span>{selected.length === 0 ? 'None selected' : `${selected.length} selected`}</span>
      </div>
      {selected.length > 0 ? (
        <ul className="cloud-service-picker__selected">
          {selected.map((id) => {
            const label = serviceLabel(cloud, id);
            return (
              <li key={id}>
                <span>{label}</span>
                <button type="button" onClick={() => onToggle(cloud, id)} aria-label={`Remove ${label}`}>
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="catalog-editor__section-copy">Choose the {cloudName} services this project can request.</p>
      )}
      <label className="label" htmlFor={`service-search-${cloud}`}>Find a {cloudName} service</label>
      <input
        id={`service-search-${cloud}`}
        className="input"
        type="search"
        value={query}
        placeholder="Search services"
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="iam-choices" role="group" aria-label={`${cloudName} services`}>
        {visible.length === 0 ? (
          <p className="access-hint">No services match that search.</p>
        ) : visible.map((service) => (
          <label key={service.id} className={selected.includes(service.id) ? 'is-current' : undefined}>
            <input
              type="checkbox"
              checked={selected.includes(service.id)}
              onChange={() => onToggle(cloud, service.id)}
            />
            <span>{service.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
