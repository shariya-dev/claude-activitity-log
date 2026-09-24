<?php

namespace App\Actions\Agent\Support;

use App\Models\Device;
use Illuminate\Http\Request;
use LogicException;

final class CurrentDevice
{
    /**
     * The device behind the request's token. Routes guarantee it through auth:sanctum (+ device.active).
     */
    public static function of(Request $request): Device
    {
        $device = $request->user('sanctum');

        if (! $device instanceof Device) {
            throw new LogicException('Agent route reached without an authenticated device.');
        }

        return $device;
    }
}
