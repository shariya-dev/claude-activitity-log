<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('sync_batches', function (Blueprint $table) {
            $table->id();
            $table->foreignId('device_id')->constrained('devices')->restrictOnDelete();
            $table->char('batch_uuid', 36);
            $table->string('status', 16)->default('processing');
            $table->boolean('is_initial')->default(false);
            $table->unsignedInteger('accepted')->default(0);
            $table->unsignedInteger('created')->default(0);
            $table->unsignedInteger('updated')->default(0);
            $table->unsignedInteger('rejected')->default(0);
            $table->json('rejections')->nullable();
            $table->string('error_code', 64)->nullable();
            $table->unsignedInteger('payload_bytes')->default(0);
            $table->unsignedInteger('duration_ms')->default(0);
            $table->json('response')->nullable();
            $table->timestamp('received_at')->useCurrent();
            $table->timestamp('completed_at')->nullable();

            $table->unique(['device_id', 'batch_uuid']);
            $table->index(['device_id', 'received_at']);
            $table->index(['status', 'received_at']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('sync_batches');
    }
};
