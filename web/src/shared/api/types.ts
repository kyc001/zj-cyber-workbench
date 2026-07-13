import type { components, paths } from "./generated/schema";

type JsonRequestBody<Operation> = Operation extends {
  requestBody: { content: { "application/json": infer Body } };
}
  ? Body
  : never;

type JsonResponse<Operation> = Operation extends {
  responses: { 200: { content: { "application/json": infer Response } } };
}
  ? Response
  : never;

type QueryParameters<Operation> = Operation extends { parameters: { query?: infer Query } } ? Query : never;
type PathParameters<Operation> = Operation extends { parameters: { path?: infer Params } } ? Params : never;

export type CommonResponsePayload = components["schemas"]["CommonResponse"];

export type LoginRequest = JsonRequestBody<paths["/api/system-users/login"]["post"]>;
export type LoginResponse = JsonResponse<paths["/api/system-users/login"]["post"]>;

export type QuerySystemUsersParams = QueryParameters<paths["/api/system-users"]["get"]>;
export type QuerySystemUsersResponse = JsonResponse<paths["/api/system-users"]["get"]>;
export type QuerySystemUsersData = NonNullable<QuerySystemUsersResponse["data"]>;
export type SystemUser = QuerySystemUsersData["items"][number];
export type SystemUserRole = components["schemas"]["SystemUserRole"];

export type CreateSystemUserRequest = JsonRequestBody<paths["/api/system-users"]["post"]>;
export type CreateSystemUserResponse = JsonResponse<paths["/api/system-users"]["post"]>;

export type SystemUserPathParams = PathParameters<paths["/api/system-users/{id}"]["patch"]>;
export type UpdateSystemUserRequest = JsonRequestBody<paths["/api/system-users/{id}"]["patch"]>;
export type UpdateSystemUserResponse = JsonResponse<paths["/api/system-users/{id}"]["patch"]>;
export type DeleteSystemUserResponse = JsonResponse<paths["/api/system-users/{id}"]["delete"]>;

export type InstanceConfig = components["schemas"]["InstanceConfigSchema"];
export type AgentConfig = components["schemas"]["AgentConfig"];
export type AgentPoolConfig = components["schemas"]["AgentPoolConfig"];
export type AgentRuntimeConfig = components["schemas"]["AgentRuntimeConfig"];
export type LightRAGConfig = components["schemas"]["LightRAGConfig"];
export type GetInstanceConfigResponse = JsonResponse<paths["/api/system-config/instance"]["get"]>;
export type UpdateInstanceConfigRequest = JsonRequestBody<paths["/api/system-config/instance"]["patch"]>;
export type UpdateInstanceConfigResponse = JsonResponse<paths["/api/system-config/instance"]["patch"]>;
export type ToolResultSchema = components["schemas"]["ToolResultSchema"];
export type ToolResultType = components["schemas"]["ToolResultTypeSchema"];
export type ReportToolResultOutput = components["schemas"]["ReportToolResultOutputSchema"];

export type QueryKnowledgeDocumentsParams = QueryParameters<paths["/api/knowledges/documents"]["get"]>;
export type QueryKnowledgeDocumentsResponse = JsonResponse<paths["/api/knowledges/documents"]["get"]>;
export type QueryKnowledgeDocumentsData = NonNullable<QueryKnowledgeDocumentsResponse["data"]>;
export type KnowledgeDocument = QueryKnowledgeDocumentsData["items"][number];
export type KnowledgeDocumentStatus = KnowledgeDocument["status"];
export type UploadKnowledgeDocumentsResponse = JsonResponse<paths["/api/knowledges/documents"]["post"]>;
export type KnowledgeDocumentPathParams = PathParameters<paths["/api/knowledges/documents/{document_id}"]["get"]>;
export type GetKnowledgeDocumentResponse = JsonResponse<paths["/api/knowledges/documents/{document_id}"]["get"]>;
export type KnowledgeDocumentDetail = NonNullable<GetKnowledgeDocumentResponse["data"]>;
export type DeleteKnowledgeDocumentResponse = JsonResponse<paths["/api/knowledges/documents/{document_id}"]["delete"]>;
export type QueryKnowledgeVectorsParams = QueryParameters<paths["/api/knowledges/vectors"]["get"]>;
export type QueryKnowledgeVectorsResponse = JsonResponse<paths["/api/knowledges/vectors"]["get"]>;
export type QueryKnowledgeVectorsData = NonNullable<QueryKnowledgeVectorsResponse["data"]>;
export type KnowledgeVector = QueryKnowledgeVectorsData["items"][number];
export type KnowledgeVectorPathParams = PathParameters<paths["/api/knowledges/vectors/{vector_id}"]["get"]>;
export type GetKnowledgeVectorResponse = JsonResponse<paths["/api/knowledges/vectors/{vector_id}"]["get"]>;
export type KnowledgeVectorDetail = NonNullable<GetKnowledgeVectorResponse["data"]>;
export type GetKnowledgeGraphParams = QueryParameters<paths["/api/knowledges/graph"]["get"]>;
export type GetKnowledgeGraphResponse = JsonResponse<paths["/api/knowledges/graph"]["get"]>;
export type SearchKnowledgeGraphParams = QueryParameters<paths["/api/knowledges/graph/search"]["get"]>;
export type SearchKnowledgeGraphResponse = JsonResponse<paths["/api/knowledges/graph/search"]["get"]>;
export type KnowledgeGraph = NonNullable<GetKnowledgeGraphResponse["data"]>;
export type KnowledgeGraphNode = KnowledgeGraph["nodes"][number];

export type QueryWorkProjectsParams = QueryParameters<paths["/api/work-projects"]["get"]>;
export type QueryWorkProjectsResponse = JsonResponse<paths["/api/work-projects"]["get"]>;
export type QueryWorkProjectsData = NonNullable<QueryWorkProjectsResponse["data"]>;
export type WorkProject = QueryWorkProjectsData["items"][number];
export type WorkProjectStatus = components["schemas"]["WorkProjectStatus"];
export type WorkProjectType = components["schemas"]["WorkProjectType"];
export type WorkProjectTaskStatus = components["schemas"]["WorkProjectTaskStatus"];
export type WorkProjectAgentSummary = components["schemas"]["WorkProjectAgentSummarySchema"];
export type WorkProjectAsset = components["schemas"]["WorkProjectAssetSchema"];
export type WorkProjectAssetExtra = components["schemas"]["WorkProjectAssetExtraSchema"];
export type WorkProjectAssetRequest = components["schemas"]["WorkProjectAssetRequest"];
export type WorkProjectAssetType = components["schemas"]["WorkProjectAssetType"];
export type WorkProjectAssetOrigin = components["schemas"]["WorkProjectAssetOrigin"];
export type WorkProjectFinding = components["schemas"]["WorkProjectFindingSchema"];
export type WorkProjectFindingSeverity = components["schemas"]["WorkProjectFindingSeverity"];
export type WorkProjectFindingStatus = components["schemas"]["WorkProjectFindingStatus"];
export type WorkProjectGraphEdge = components["schemas"]["WorkProjectGraphEdgeSchema"];
export type WorkProjectGraphEdgeType = components["schemas"]["WorkProjectGraphEdgeType"];
export type WorkProjectGraphSnapshot = components["schemas"]["WorkProjectGraphSnapshotSchema"];
export type WorkProjectAttackPath = components["schemas"]["WorkProjectAttackPathSchema"];
export type WorkProjectAttackPathStatus = components["schemas"]["WorkProjectAttackPathStatus"];
export type WorkProjectAttackPathStep = components["schemas"]["WorkProjectAttackPathStepSchema"];
export type WorkProjectRecords = components["schemas"]["WorkProjectRecordsSchema"];
export type WorkProjectRecordSnapshot = components["schemas"]["WorkProjectRecordSnapshotSchema"];

export type CreateWorkProjectRequest = JsonRequestBody<paths["/api/work-projects"]["post"]>;
export type CreateWorkProjectResponse = JsonResponse<paths["/api/work-projects"]["post"]>;

export type WorkProjectPathParams = PathParameters<paths["/api/work-projects/{id}/record-snapshot"]["get"]>;
export type UpdateWorkProjectMetadataRequest = JsonRequestBody<paths["/api/work-projects/{id}/metadata"]["patch"]>;
export type UpdateWorkProjectMetadataResponse = JsonResponse<paths["/api/work-projects/{id}/metadata"]["patch"]>;
export type DeleteWorkProjectResponse = JsonResponse<paths["/api/work-projects/{id}"]["delete"]>;
export type CancelWorkProjectPathParams = PathParameters<paths["/api/work-projects/{id}/cancel"]["post"]>;
export type CancelWorkProjectResponse = JsonResponse<paths["/api/work-projects/{id}/cancel"]["post"]>;
export type RetryWorkProjectPathParams = PathParameters<paths["/api/work-projects/{id}/retry"]["post"]>;
export type RetryWorkProjectResponse = JsonResponse<paths["/api/work-projects/{id}/retry"]["post"]>;
export type ListWorkProjectSessionsResponse = JsonResponse<paths["/api/work-projects/{id}/sessions"]["get"]>;
export type CreateWorkProjectSessionResponse = JsonResponse<paths["/api/work-projects/{id}/sessions"]["post"]>;
export type DeleteWorkProjectSessionResponse = JsonResponse<paths["/api/work-projects/{id}/sessions/{session_id}"]["delete"]>;
export type GetWorkProjectRecordSnapshotResponse = JsonResponse<paths["/api/work-projects/{id}/record-snapshot"]["get"]>;

export type AgentSessionSummary = components["schemas"]["AgentSessionSummarySchema"];
export type SessionType = components["schemas"]["SessionType"];

export type AgentInfo = components["schemas"]["AgentInfoSchema"];
export type ListAgentsResponse = JsonResponse<paths["/api/agents"]["get"]>;
export type ListAgentsData = NonNullable<ListAgentsResponse["data"]>;

export type ListAgentSessionsResponse = JsonResponse<paths["/api/agent-sessions"]["get"]>;
export type ListAgentSessionsData = NonNullable<ListAgentSessionsResponse["data"]>;

export type AgentTurnRequest = JsonRequestBody<paths["/api/agent-sessions/turns"]["post"]>;
export type AgentTurnData = components["schemas"]["AgentTurnResponse"];
export type CreateAgentSessionTurnResponse = JsonResponse<paths["/api/agent-sessions/turns"]["post"]>;
export type SubmitAgentSessionTurnResponse = JsonResponse<paths["/api/agent-sessions/{session_id}/turns"]["post"]>;
export type InterruptAgentSessionResponse = JsonResponse<paths["/api/agent-sessions/{session_id}/interrupt"]["post"]>;
export type CancelAllAgentSessionTasksResponse = JsonResponse<paths["/api/agent-sessions/{session_id}/cancel-all"]["post"]>;

export type ListAgentEventsResponse = JsonResponse<paths["/api/agent-sessions/{session_id}/events"]["get"]>;
export type ListAgentEventsData = NonNullable<ListAgentEventsResponse["data"]>;
export type DownloadAgentReportPathParams = PathParameters<paths["/api/agent-sessions/reports/{report_id}/download"]["get"]>;
export type UpdateAgentSessionTitleRequest = JsonRequestBody<paths["/api/agent-sessions/{session_id}/title"]["patch"]>;
export type UpdateAgentSessionTitleResponse = JsonResponse<paths["/api/agent-sessions/{session_id}/title"]["patch"]>;
export type DeleteAgentSessionResponse = JsonResponse<paths["/api/agent-sessions/{session_id}"]["delete"]>;

export type UserMessageEvent = components["schemas"]["UserMessageEvent"];
export type TurnBoundaryEvent = components["schemas"]["TurnBoundaryEvent"];
export type TextDeltaEvent = components["schemas"]["TextDeltaEvent"];
export type TextCompleteEvent = components["schemas"]["TextCompleteEvent"];
export type ThinkingDeltaEvent = components["schemas"]["ThinkingDeltaEvent"];
export type ThinkingCompleteEvent = components["schemas"]["ThinkingCompleteEvent"];
export type ToolCallEvent = components["schemas"]["ToolCallEvent"];
export type ToolResultEvent = components["schemas"]["ToolResultEvent"];
export type SubagentTaskEvent = components["schemas"]["SubagentTaskEvent"];
export type AgentSubordinateStatus = components["schemas"]["AgentSubordinateStatus"];
export type ErrorEvent = components["schemas"]["ErrorEvent"];
export type DoneEvent = components["schemas"]["DoneEvent"];
export type RunStateEvent = components["schemas"]["RunStateEvent"];
export type AgentInputPart = components["schemas"]["AgentTextInputPart"] | components["schemas"]["AgentImageInputPart"];
export type AgentTextInputPart = components["schemas"]["AgentTextInputPart"];
export type AgentImageInputPart = components["schemas"]["AgentImageInputPart"];

export type AgentContentEvent = ListAgentEventsData["items"][number];
export type AgentStreamEvent = components["schemas"]["AgentEventSchema"];
