from schema.common.responses import CommonResponse
from schema.system_config.config import (
    FetchProviderModelsRequest,
    FetchProviderModelsResponse,
    UpdateInstanceConfigRequest,
    UpdateInstanceConfigResponse,
)
from service.system_config.config import (
    fetch_provider_models,
    get_instance_config,
    update_instance_config,
)


async def get_instance_config_handler() -> CommonResponse:
    result = await get_instance_config()
    return CommonResponse(data=result.config)


async def update_instance_config_handler(request: UpdateInstanceConfigRequest) -> CommonResponse:
    result = await update_instance_config(request)
    return CommonResponse(data=UpdateInstanceConfigResponse(config=result.config, restarted=result.restarted))


async def fetch_provider_models_handler(request: FetchProviderModelsRequest) -> CommonResponse:
    models = await fetch_provider_models(request.base_url, request.api_key)
    return CommonResponse(data=FetchProviderModelsResponse(models=models))
