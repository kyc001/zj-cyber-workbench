import { useCallback, useEffect, useState } from "react";
import { getApiErrorMessage } from "../../shared/api/feedback";
import { getWorkProjectRecordSnapshot } from "../../shared/api/workProjects";
import type { WorkProject, WorkProjectGraphSnapshot, WorkProjectRecordSnapshot, WorkProjectRecords } from "../../shared/api/types";

export type WorkProjectSnapshotState = {
  project: WorkProject | null;
  records: WorkProjectRecords;
  loading: boolean;
  error: string;
  refresh: () => void;
};

export const EMPTY_WORK_PROJECT_GRAPH: WorkProjectGraphSnapshot = {
  edges: [],
  attack_paths: [],
  attack_path_steps: [],
};

export const EMPTY_WORK_PROJECT_RECORDS: WorkProjectRecords = {
  assets: [],
  findings: [],
  graph: EMPTY_WORK_PROJECT_GRAPH,
};

export async function loadWorkProjectRecordSnapshot(projectId: number): Promise<WorkProjectRecordSnapshot> {
  const response = await getWorkProjectRecordSnapshot(projectId);
  if (!response.data) throw new Error("工作项目快照为空");
  return response.data;
}

export function useWorkProjectRecordSnapshot(projectId: number | null, enabled = true): WorkProjectSnapshotState {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<Omit<WorkProjectSnapshotState, "refresh">>({
    project: null,
    records: EMPTY_WORK_PROJECT_RECORDS,
    loading: false,
    error: "",
  });

  useEffect(() => {
    let canceled = false;
    if (!enabled || !projectId) {
      setState({ project: null, records: EMPTY_WORK_PROJECT_RECORDS, loading: false, error: "" });
      return () => {
        canceled = true;
      };
    }

    setState((current) => (
      current.project?.id === projectId
        ? { ...current, loading: true, error: "" }
        : { project: null, records: EMPTY_WORK_PROJECT_RECORDS, loading: true, error: "" }
    ));
    loadWorkProjectRecordSnapshot(projectId)
      .then((snapshot) => {
        if (!canceled) setState({ project: snapshot.project, records: snapshot.records, loading: false, error: "" });
      })
      .catch((error) => {
        if (!canceled) {
          setState((current) => ({
            ...current,
            loading: false,
            error: getApiErrorMessage(error, "加载项目详情失败"),
          }));
        }
      });

    return () => {
      canceled = true;
    };
  }, [enabled, projectId, version]);

  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  return { ...state, refresh };
}

export type { WorkProjectRecordSnapshot, WorkProjectRecords };
