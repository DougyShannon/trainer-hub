import { useState } from "react";
import { send, useApi } from "../lib/api";
import { ErrorBox, Loading } from "../components/ui";
import { NotFoundPage } from "./NotFoundPage";
import { timeAgo } from "./PlayPage";

type Request = { id: number; request: string; status: "new" | "done" | "declined"; created_at: string; trainer_name: string | null };

/** Site change requests that trainers made through the assistant. Only the site owner can see this. */
export function RequestsPage() {
  const [key, setKey] = useState(0);
  const { data, error, loading } = useApi<Request[]>("/api/assistant/requests", { fresh: true, reloadKey: key });
  if (loading && !data) return <Loading />;
  if (error === "Not found" || error === "Please log in first") return <NotFoundPage />;
  if (error || !data) return <ErrorBox message={error ?? "Unknown error"} />;

  const mark = async (id: number, status: Request["status"]) => {
    await send("PUT", `/api/assistant/requests/${id}`, { status });
    setKey((k) => k + 1);
  };

  return (
    <div className="requests">
      <div className="page-head">
        <div>
          <h1>Site change requests</h1>
          <p className="muted">Changes trainers asked Professor Hub for. Pass the ones you want to Claude in your project to build.</p>
        </div>
      </div>
      {data.length ? (
        <ul className="game-list wide">
          {data.map((r) => (
            <li key={r.id} className={`request ${r.status}`}>
              <span className="request-text">{r.request}</span>
              <span className="game-meta">
                {r.trainer_name ?? "A former trainer"} · {timeAgo(r.created_at)} · {r.status}
              </span>
              <span className="row-actions">
                {r.status !== "done" && (
                  <button type="button" className="secondary-btn small" onClick={() => mark(r.id, "done")}>
                    Mark done
                  </button>
                )}
                {r.status === "new" && (
                  <button type="button" className="secondary-btn small" onClick={() => mark(r.id, "declined")}>
                    Decline
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No requests yet.</p>
      )}
    </div>
  );
}
