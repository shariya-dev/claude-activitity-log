<?php

namespace App\Http\Controllers\Api\Agent\V1;

use App\Actions\Ingestion\Exceptions\BatchInProgressException;
use App\Actions\Ingestion\Exceptions\PersistenceFailedException;
use App\Actions\Ingestion\IngestSyncBatch;
use App\Actions\Ingestion\Support\AgentErrorResponse;
use App\Http\Controllers\Controller;
use App\Http\Requests\Agent\SyncRequest;
use App\Http\Resources\Agent\SyncResultResource;
use App\Models\Device;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/agent/v1/sync: upload activity (docs/contracts/sync-api-v1.md §3.4).
 */
class SyncController extends Controller
{
    public function __invoke(SyncRequest $request, IngestSyncBatch $ingest): JsonResponse
    {
        $device = $request->device();
        assert($device instanceof Device);

        try {
            $body = $ingest->handle($device, $request->validated(), $request->payloadBytes());
        } catch (BatchInProgressException) {
            return AgentErrorResponse::batchInProgress();
        } catch (PersistenceFailedException) {
            return AgentErrorResponse::persistenceFailed();
        }

        return (new SyncResultResource($body))->response($request);
    }
}
