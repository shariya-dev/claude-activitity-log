<?php

namespace App\Http\Controllers\Api\Agent\V1;

use App\Actions\Agent\GetSyncStatus;
use App\Actions\Agent\Support\CurrentDevice;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SyncStatusController extends Controller
{
    public function __invoke(Request $request, GetSyncStatus $getSyncStatus): JsonResponse
    {
        return response()->json($getSyncStatus->handle(CurrentDevice::of($request)));
    }
}
