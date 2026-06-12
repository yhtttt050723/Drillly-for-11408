"""初始化示例题：python scripts/seed_demo.py"""
import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API_ROOT))

from app.database import SessionLocal, init_db
from app.models import Category, Question, QuestionBank, Tag

DEMO = [
    {
        "type": "single_choice",
        "category": "数学",
        "tags": ["高数", "导数"],
        "content": {
            "type": "single_choice",
            "title": "导数基础",
            "stem": r"设 $f(x)=x^3$，则 $f'(1)=$",
            "options": [
                {"key": "A", "content": "$1$"},
                {"key": "B", "content": "$2$"},
                {"key": "C", "content": "$3$"},
                {"key": "D", "content": "$4$"},
            ],
            "answer": ["C"],
            "explanation": r"$f'(x)=3x^2$，代入 $x=1$ 得 $3$。",
            "metadata": {"difficulty": "easy"},
        },
    },
    {
        "type": "multiple_choice",
        "category": "数学",
        "tags": ["线代"],
        "content": {
            "type": "multiple_choice",
            "title": "矩阵性质",
            "stem": "下列关于 $n$ 阶方阵的说法，正确的有：",
            "options": [
                {"key": "A", "content": "可逆矩阵必满秩"},
                {"key": "B", "content": "对称矩阵必可对角化"},
                {"key": "C", "content": "$|AB|=|A||B|$"},
                {"key": "D", "content": "秩相等则矩阵相等"},
            ],
            "answer": ["A", "C"],
            "explanation": "B、D 一般不成立。",
            "metadata": {"difficulty": "medium"},
        },
    },
    {
        "type": "coding",
        "category": "编程",
        "tags": ["Python"],
        "content": {
            "type": "coding",
            "title": "A+B",
            "stem": "读入两个整数，输出它们的和。",
            "answer": [],
            "language": "python",
            "explanation": "```python\na,b=map(int,input().split())\nprint(a+b)\n```",
            "metadata": {"difficulty": "easy"},
        },
    },
]


def main() -> None:
    init_db()
    db = SessionLocal()
    try:
        if db.query(Question).count() > 0:
            print("已有题目，跳过 seed（如需重置请删 data/drillly.db）")
            return

        bank = QuestionBank(name="默认题库")
        db.add(bank)
        db.flush()

        for item in DEMO:
            cat = db.query(Category).filter(Category.name == item["category"]).first()
            if not cat:
                cat = Category(name=item["category"])
                db.add(cat)
                db.flush()

            tag_objs = []
            for name in item["tags"]:
                t = db.query(Tag).filter(Tag.name == name).first()
                if not t:
                    t = Tag(name=name)
                    db.add(t)
                    db.flush()
                tag_objs.append(t)

            q = Question(
                bank_id=bank.id,
                category_id=cat.id,
                type=item["type"],
                content=item["content"],
            )
            q.tags = tag_objs
            db.add(q)

        db.commit()
        print(f"已写入 {len(DEMO)} 道示例题")
    finally:
        db.close()


if __name__ == "__main__":
    main()
