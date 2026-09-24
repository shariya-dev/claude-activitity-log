<?php

namespace App\Enums;

enum SessionStatus: string
{
    case Active = 'active';
    case Idle = 'idle';
    case Ended = 'ended';
}
