<?php

namespace App\Enums;

enum SyncHealth: string
{
    case Healthy = 'healthy';
    case Offline = 'offline';
    case SyncFailed = 'sync_failed';
    case Disabled = 'disabled';
}
