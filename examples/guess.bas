10 REM Number guessing game
20 T = INT(RND(1) * 100) + 1
30 N = 0
40 INPUT "Guess (1-100)"; G
50 N = N + 1
60 IF G < T THEN PRINT "Higher": GOTO 40
70 IF G > T THEN PRINT "Lower": GOTO 40
80 PRINT "Correct in "; N; " tries!"
