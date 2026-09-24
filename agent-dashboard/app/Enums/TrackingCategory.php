<?php

namespace App\Enums;

enum TrackingCategory: string
{
    case Session = 'session';
    case Usage = 'usage';
    case Project = 'project';
    case Model = 'model';
    case Device = 'device';
    case Account = 'account';
    case Prompt = 'prompt';
    case Git = 'git';
    case Network = 'network';
}
