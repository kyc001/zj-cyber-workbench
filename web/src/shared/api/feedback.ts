import { Toast } from "@douyinfe/semi-ui";
import { ApiError } from "./client";
import type { CommonResponsePayload } from "./types";

export function showApiSuccess(response: CommonResponsePayload) {
  if (response.message) {
    Toast.success(response.message);
  }
}

export function getApiErrorMessage(error: unknown, fallback = "网络请求失败"): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return "无法连接到服务，请检查服务状态后重试";
    return error.response?.message || fallback;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

export function showApiError(error: unknown) {
  Toast.error(getApiErrorMessage(error));
}
