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

    await fetch("http://localhost:8080/create-pr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    alert("PR Created");
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
      <button onClick={submit}>Create PR</button>
    </div>
  );
}
