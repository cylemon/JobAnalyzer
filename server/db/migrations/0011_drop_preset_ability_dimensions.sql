-- 预置能力维度下线：能力词表不再有预置项，清单只由用户新增与解析岗位时生长出来。
-- 键名是早期版本启动播种时写死的常量，所以这里能按固定清单清理。
-- 仍在岗位要求里被引用的维度保留——删掉会让那些岗位的能力条目丢掉受控键，
-- 而键一旦消失，用户重新录入同名能力也对不回原来的条目。
DELETE FROM `ability_dimension`
WHERE `key` IN (
	'ai-agent-design', 'llm-latency-tuning', 'rag-engineering', 'prompt-engineering',
	'high-concurrency', 'distributed-architecture', 'performance-tuning', 'data-pipeline',
	'cloud-native', 'engineering-quality', 'tech-leadership', 'business-domain'
)
  AND `key` NOT IN (SELECT DISTINCT `key` FROM `job_requirement` WHERE `kind` = 'ABILITY')
  AND `key` NOT IN (SELECT DISTINCT `dimension_key` FROM `personal_ability`);
