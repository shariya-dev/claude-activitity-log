<?php

namespace App\Enums;

enum SyncBatchStatus: string
{
    case Processing = 'processing';
    case Succeeded = 'succeeded';
    case Failed = 'failed';
}
