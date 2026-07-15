
from fastapi import APIRouter, Depends

from handler.approval import (
    approve_handler,
    consume_handler,
    create_approval_handler,
    evaluate_action_handler,
    list_approvals_handler,
    reject_handler,
)
from middleware.auth import require_admin, require_user
from schema.action import PolicyDecision
from schema.approval_api import (
    ApprovalConsumeResponse,
    ApprovalCreateResponse,
    ApprovalDecisionResponse,
    ApprovalRecord,
)
from schema.common.responses import CommonResponse

router = APIRouter(prefix="/approvals", tags=["approvals"], dependencies=[Depends(require_user)])


router.add_api_route("/evaluate", evaluate_action_handler, methods=["POST"], response_model=CommonResponse[PolicyDecision])
router.add_api_route("", create_approval_handler, methods=["POST"], response_model=CommonResponse[ApprovalCreateResponse], dependencies=[Depends(require_admin)])
router.add_api_route("", list_approvals_handler, methods=["GET"], response_model=CommonResponse[list[ApprovalRecord]])
router.add_api_route("/{approval_id}/approve", approve_handler, methods=["POST"], response_model=CommonResponse[ApprovalDecisionResponse], dependencies=[Depends(require_admin)])
router.add_api_route("/{approval_id}/reject", reject_handler, methods=["POST"], response_model=CommonResponse[ApprovalDecisionResponse], dependencies=[Depends(require_admin)])
router.add_api_route("/consume", consume_handler, methods=["POST"], response_model=CommonResponse[ApprovalConsumeResponse], dependencies=[Depends(require_admin)])
