import { Button, Empty, Spin } from "@douyinfe/semi-ui";
import { ArrowLeft, CircleAlert, FileText, RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MetricStrip } from "../../shared/components/ResourcePageShell";
import { WorkProjectRecordTabs } from "./ProjectRecordViews";
import { useWorkProjectRecordSnapshot } from "./workProjectRecords";
import { workProjectOwnerNames, WorkProjectStatusTag, WorkProjectTypeTag } from "./workProjectView";

export function WorkProjectWorkspacePage() {
  const params = useParams();
  const navigate = useNavigate();
  const projectId = Number(params.projectId);
  const validProjectId = Number.isFinite(projectId) && projectId > 0 ? projectId : null;
  const { project, records, loading, error, refresh } = useWorkProjectRecordSnapshot(validProjectId);

  const metrics = useMemo(() => [
    { label: "资产", value: records.assets.length },
    { label: "发现", value: records.findings.length },
    { label: "关系", value: records.graph.edges.length },
    { label: "会话", value: project?.session_count ?? 0 },
  ], [project, records]);

  if (!validProjectId) {
    return <Empty className="empty-state" image={<FileText size={42} />} title="项目无效" description="" />;
  }

  return (
    <section className="work-project-workspace">
      <div className="workspace-back-row">
        <Button icon={<ArrowLeft size={15} />} theme="borderless" type="tertiary" onClick={() => navigate("/work-projects")}>
          返回
        </Button>
        <Button
          icon={<RefreshCw size={15} />}
          theme="borderless"
          type="tertiary"
          loading={loading}
          disabled={loading}
          onClick={refresh}
        >
          刷新
        </Button>
      </div>
      {error ? (
        <div className="workspace-load-error" role="alert">
          <CircleAlert size={17} aria-hidden="true" />
          <span>
            <strong>无法加载项目详情</strong>
            <span>{error}</span>
          </span>
          <Button size="small" icon={<RefreshCw size={14} />} disabled={loading} onClick={refresh}>
            重试
          </Button>
        </div>
      ) : null}
      <div className="workspace-header">
        {project ? (
          <div className="workspace-title">
            <div className="workspace-title-main">
              <h2>{project.name}</h2>
              {project.description ? <p>{project.description}</p> : null}
              <span>负责人：{workProjectOwnerNames(project)}</span>
            </div>
            <div className="workspace-title-tags">
              <WorkProjectTypeTag project={project} />
              <WorkProjectStatusTag project={project} />
            </div>
          </div>
        ) : null}
      </div>

      <MetricStrip metrics={metrics} />

      <Spin spinning={loading}>
        {!loading && !project && !error ? (
          <Empty className="empty-state" image={<FileText size={42} />} title="项目不存在" description="" />
        ) : (
          <WorkProjectRecordTabs
            records={records}
            projectId={validProjectId}
            onRecordsChanged={refresh}
            className="workspace-tabs"
          />
        )}
      </Spin>
    </section>
  );
}
