// pages/aws.tsx
import { useState } from "react";
import { awsServices, awsServiceList } from "../config/awsServices";

export default function AWSPage() {
  const [team, setTeam] = useState("");
  const [env, setEnv] = useState("");
  const [service, setService] = useState("");

  const submit = async () => {
    const payload = {
      team,
      env,
      cloud: "aws",
      service
    };

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (token && token !== 'undefined') headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${apiUrl}/api/request`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      alert(data.message || 'Request submitted. An admin will approve it and the PR will be created.');
    } else {
      alert(data.error || 'Request failed');
    }
  };

  return (
    <div style={{ padding: 40 }}>
      <h2>AWS – Select Service</h2>

      <input placeholder="Team" onChange={e => setTeam(e.target.value)} />
      <br /><br />

      <input placeholder="Environment" onChange={e => setEnv(e.target.value)} />
      <br /><br />

      <select onChange={e => setService(e.target.value)}>
        <option value="">Select Service</option>
        {awsServiceList.map(s => {
          const serviceConfig = awsServices[s];
          return (
            <option key={s} value={s}>
              {serviceConfig?.displayName || s}
            </option>
          );
        })}
      </select>

      <br /><br />
      <button type="button" onClick={submit}>Create PR</button>
    </div>
  );
}
