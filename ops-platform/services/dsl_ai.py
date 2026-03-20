import anthropic
import logging

logger = logging.getLogger(__name__)


class DSLGenerator:
    def __init__(self):
        self.client = anthropic.Anthropic()

    def generate(self, intent: str, transaction_set: str) -> dict:
        """
        Generate DSL from a natural-language intent using Claude.

        Returns:
          {'status': 'ok', 'dsl': str, 'validation': dict}   on success
          {'status': 'needs_keyword', 'description': str}     if AI signals NEEDS_NEW_KEYWORD
          {'status': 'error', 'error': str}                   on failure
        """
        from apps.maps.models import JediSampleFixture, DSLExample, DSLKeywordRequest
        from services.engine_client import EngineClient

        # 1. Load JEDI sample fixture for context
        fixture = JediSampleFixture.objects.filter(
            transaction_set=transaction_set, is_default=True
        ).first()
        jedi_schema_hint = str(fixture.sample_jedi)[:2000] if fixture else '(no sample available)'

        # 2. Load few-shot examples (up to 5)
        examples = DSLExample.objects.filter(transaction_set=transaction_set)[:5]
        few_shot = '\n\n'.join(
            f'Intent: {ex.intent}\nDSL:\n{ex.dsl_source}'
            for ex in examples
        )

        # 3. Fetch AI vocabulary from engine
        try:
            engine = EngineClient()
            keywords = engine.get_vocabulary()
            vocabulary_str = ', '.join(keywords)
        except Exception as exc:
            logger.warning(f'Could not fetch vocabulary from engine: {exc}')
            vocabulary_str = (
                '$map, $if, $else, $omit, $concat, $lookup, '
                '$overwrite, $as, $sum-of, $substring'
            )

        # 4. Build prompt
        system_prompt = f"""You are an EDI mapping specialist. Generate DSL mapping rules using ONLY the following keywords:
{vocabulary_str}

DSL Grammar:
- $map <source_path> to <target_path> [$as string|number|date|uppercase|trimmed|timestamp]
- $if <source_path> present [to <target>] [$else $omit | $else "<default>"]
- $if <source_path> equals "<value>" [to <target>] [$else $omit | $else "<default>"]
- $concat "<separator>" <source1> <source2> ... to <target>
- $lookup <TableName> <source_path> to <target>
- $overwrite <source_path> to <target>
- $sum-of <source_path> to <target>
- $substring <source_path> <start> <length> to <target>

IMPORTANT RULES:
1. NEVER generate $expr — it is forbidden for AI use.
2. Use ONLY the keywords listed above.
3. Source paths use dot notation matching the JEDI structure (e.g. b2.b2_element_02).
4. If you cannot express the mapping using available keywords, respond with EXACTLY:
   NEEDS_NEW_KEYWORD: <brief description of what capability is needed>

JEDI structure sample for {transaction_set}:
{jedi_schema_hint}"""

        user_message = f"""Generate DSL mapping rules for the following intent:

{intent}

Transaction set: {transaction_set}
{"" if not few_shot else chr(10) + "Few-shot examples:" + chr(10) + few_shot}

Respond with only the DSL rules, one per line. No explanations."""

        # 5. Call Claude
        try:
            message = self.client.messages.create(
                model='claude-sonnet-4-6',
                max_tokens=1024,
                system=system_prompt,
                messages=[{'role': 'user', 'content': user_message}],
            )
            response_text = message.content[0].text.strip()
        except Exception as exc:
            logger.error(f'Claude API error: {exc}')
            return {'status': 'error', 'error': str(exc)}

        # 6. Parse response
        if response_text.startswith('NEEDS_NEW_KEYWORD:'):
            description = response_text[len('NEEDS_NEW_KEYWORD:'):].strip()
            DSLKeywordRequest.objects.create(
                intent=intent,
                description=description,
                transaction_set=transaction_set,
            )
            return {'status': 'needs_keyword', 'description': description}

        # 7. Validate generated DSL
        try:
            engine = EngineClient()
            validation = engine.compile_dsl(dsl=response_text, transaction_set=transaction_set)
            return {'status': 'ok', 'dsl': response_text, 'validation': validation}
        except Exception as exc:
            logger.warning(f'DSL validation failed: {exc}')
            return {
                'status': 'ok',
                'dsl': response_text,
                'validation': {'ok': False, 'error': str(exc)},
            }
