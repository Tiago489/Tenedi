import logging
import anthropic

logger = logging.getLogger(__name__)

TRANSACTION_SET_NAMES = {
    '204': 'Motor Carrier Load Tender',
    '210': 'Motor Carrier Freight Details and Invoice',
    '211': 'Motor Carrier Bill of Lading',
    '214': 'Shipment Status Message',
    '990': 'Response to a Load Tender',
    '997': 'Functional Acknowledgment',
}


class NarrativeService:
    def __init__(self):
        self.client = anthropic.Anthropic()

    def generate(self, job) -> str:
        """
        Generate a plain-English narrative for a job detail view.
        Returns a 2-3 sentence summary of what happened.
        Falls back to a plain-text summary if the Claude call fails.
        """
        tx_name = TRANSACTION_SET_NAMES.get(job.transaction_set, job.transaction_set or 'EDI document')
        duration_s = None
        if job.received_at and job.processed_at:
            delta = job.processed_at - job.received_at
            duration_s = round(delta.total_seconds(), 2)

        facts = [
            f"Transaction set: {job.transaction_set} ({tx_name})" if job.transaction_set else None,
            f"Source: {job.source}",
            f"Queue: {job.queue}",
            f"Status: {job.status}",
            f"Received: {job.received_at.strftime('%Y-%m-%d %H:%M:%S UTC') if job.received_at else 'unknown'}",
            f"Processed: {job.processed_at.strftime('%Y-%m-%d %H:%M:%S UTC') if job.processed_at else 'not yet'}",
            f"Processing time: {duration_s}s" if duration_s is not None else None,
            f"Retry count: {job.retry_count}" if job.retry_count else None,
            f"Error: {job.error_message}" if job.error_message else None,
            f"Payload preview (first 200 chars): {job.payload_preview[:200]}" if job.payload_preview else None,
        ]
        facts_str = '\n'.join(f for f in facts if f)

        prompt = (
            f"You are summarising an EDI job record for an operations engineer. "
            f"Write 2-3 concise sentences in plain English describing what happened. "
            f"Mention the transaction set type, source, outcome, and any notable details "
            f"(timing, errors, retries). Do not use bullet points or headers.\n\n"
            f"Job facts:\n{facts_str}"
        )

        try:
            message = self.client.messages.create(
                model='claude-sonnet-4-6',
                max_tokens=256,
                messages=[{'role': 'user', 'content': prompt}],
            )
            return message.content[0].text.strip()
        except Exception as exc:
            logger.warning(f'Narrative generation failed for job {job.job_id}: {exc}')
            return self._fallback(job, tx_name, duration_s)

    def _fallback(self, job, tx_name: str, duration_s) -> str:
        parts = [
            f"{tx_name} received via {job.source} on "
            f"{job.received_at.strftime('%Y-%m-%d') if job.received_at else 'unknown date'}.",
        ]
        if job.status == 'completed':
            timing = f' in {duration_s}s' if duration_s is not None else ''
            parts.append(f"Job completed successfully{timing}.")
        elif job.status == 'failed':
            parts.append(f"Job failed after {job.retry_count} retries.")
            if job.error_message:
                parts.append(f"Error: {job.error_message}")
        return ' '.join(parts)
