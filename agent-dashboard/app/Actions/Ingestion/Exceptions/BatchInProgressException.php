<?php

namespace App\Actions\Ingestion\Exceptions;

use RuntimeException;

/**
 * Another request is still processing the same (device, batch_id) and is younger than the stale threshold.
 */
class BatchInProgressException extends RuntimeException {}
