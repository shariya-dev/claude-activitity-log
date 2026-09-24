<?php

namespace App\Http\Controllers\Api\Agent\V1;

use App\Actions\Agent\DeregisterDevice;
use App\Actions\Agent\Support\CurrentDevice;
use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class DeregisterController extends Controller
{
    public function __invoke(Request $request, DeregisterDevice $deregisterDevice): Response
    {
        $deregisterDevice->handle(CurrentDevice::of($request));

        return response()->noContent();
    }
}
