from uuid import UUID

from middleware.auth import AuthUser
from schema.approval_api import (
    ApprovalConsumeRequest,
    ApprovalConsumeResponse,
    ApprovalCreateRequest,
    ApprovalCreateResponse,
    ApprovalDecisionResponse,
    ApprovalRecord,
    EvaluateActionRequest,
)
from schema.common.responses import CommonResponse
from service import approval


def evaluate_action_handler(request: EvaluateActionRequest) -> CommonResponse:
    return CommonResponse(data=approval.evaluate(request))


def create_approval_handler(request: ApprovalCreateRequest, user: AuthUser) -> CommonResponse[ApprovalCreateResponse]:
    record = approval.create(request, requester_id=user.id, default_approver_id=user.id)
    return CommonResponse(data=ApprovalCreateResponse(approval=record))


def list_approvals_handler() -> CommonResponse[list[ApprovalRecord]]:
    return CommonResponse(data=approval.list_records())


def approve_handler(approval_id: UUID, user: AuthUser) -> CommonResponse[ApprovalDecisionResponse]:
    record, token = approval.decide(approval_id, approver_id=user.id, approved=True)
    return CommonResponse(data=ApprovalDecisionResponse(approval=record, token=token))


def reject_handler(approval_id: UUID, user: AuthUser) -> CommonResponse[ApprovalDecisionResponse]:
    record, _ = approval.decide(approval_id, approver_id=user.id, approved=False)
    return CommonResponse(data=ApprovalDecisionResponse(approval=record))


def consume_handler(request: ApprovalConsumeRequest, user: AuthUser) -> CommonResponse[ApprovalConsumeResponse]:
    record, claims = approval.consume(action=request.action, token=request.token, approver_id=user.id)
    return CommonResponse(data=ApprovalConsumeResponse(
        approval_id=record.approval_id,
        consumed=True,
        claims=claims.model_dump(mode="json"),
    ))
